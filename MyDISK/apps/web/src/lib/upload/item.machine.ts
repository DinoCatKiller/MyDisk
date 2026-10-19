/**
 * 单文件上传状态机（xstate v5 核心，框架无关）。
 *
 * 状态图（X1 §3.1）：
 * - `queued`  → `GRANT` → `active`；`PAUSE` → `paused`；`STOP` → `canceled`
 * - `active`（复合态）入口即 `upload.init` 幂等对账：`preparing` → `transferring` → `merging`
 * - `active` → `done`（秒传 / `complete` 成功）/ `paused` / `failed` / `canceled`
 * - `paused` → `RESUME` → `queued`；`failed` → `RETRY` → `queued`
 *
 * `PAUSE` / `STOP` 通过中断在飞 invoke 取消 XHR（`chunkPump` 在退出时 abort）。
 */
import type { FileNodeRow } from "@MyDISK/db/schema";
import { assign, fromCallback, fromPromise, sendParent, setup, type ActorRefFrom } from "xstate";

import { client } from "~/utils/orpc";

import {
  deleteBlob,
  deleteHandle,
  deleteSession,
  putSession,
  type PersistedSession,
  type UploadCarrier,
} from "./idb";
import { computeSha256, uploadChunk } from "./transport";

/** 超过该大小就不计算 SHA-256（避免大文件在准备阶段长时间阻塞）。 */
const INSTANT_HASH_LIMIT = 32 * 1024 * 1024;
const DEFAULT_MAX_PARALLEL_CHUNKS = 3;
const MAX_CHUNK_ATTEMPTS = 4;

export type ItemInput = {
  fingerprint: string;
  name: string;
  size: number;
  mtime: number;
  mime: string | null;
  parentId: string | null;
  connectionId: string | null;
  relativePath: string | null;
  source: File | Blob | null;
  handle: FileSystemFileHandle | null;
  carrier: UploadCarrier;
  maxParallelChunks?: number;
};

export type ItemContext = {
  fingerprint: string;
  name: string;
  size: number;
  mtime: number;
  mime: string | null;
  parentId: string | null;
  connectionId: string | null;
  relativePath: string | null;
  source: File | Blob | null;
  handle: FileSystemFileHandle | null;
  blob: Blob | null;
  carrier: UploadCarrier;
  uploadId: string | null;
  chunkSize: number;
  totalChunks: number;
  uploadedParts: number[];
  uploadedBytes: number;
  file: FileNodeRow | null;
  progress: number;
  error: string | null;
  maxParallelChunks: number;
};

export type ItemEvent =
  | { type: "GRANT" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "RETRY" }
  | { type: "CHUNK_ACK"; index: number; bytes: number; uploadedParts: number[] }
  | { type: "PUMP_DONE" }
  | { type: "PUMP_ERROR"; error: string };

type PrepareInput = {
  fingerprint: string;
  name: string;
  size: number;
  mime: string | null;
  parentId: string | null;
  connectionId: string | null;
  relativePath: string | null;
  source: File | Blob | null;
  handle: FileSystemFileHandle | null;
  carrier: UploadCarrier;
};

type PrepareOutput =
  | { instant: true; file: FileNodeRow }
  | {
      instant: false;
      uploadId: string;
      chunkSize: number;
      totalChunks: number;
      uploadedParts: number[];
      blob: Blob;
    };

type PumpInput = {
  uploadId: string;
  blob: Blob;
  chunkSize: number;
  totalChunks: number;
  uploadedParts: number[];
  startBytes: number;
  maxParallelChunks: number;
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("已取消", "AbortError"));
      },
      { once: true },
    );
  });
}

async function resolveBlob(input: PrepareInput): Promise<Blob> {
  if (input.source) {
    return input.source;
  }
  if (input.handle) {
    return input.handle.getFile();
  }
  throw new Error("缺少文件载体，请重新选择文件");
}

const prepareSession = fromPromise<PrepareOutput, PrepareInput>(async ({ input }) => {
  const blob = await resolveBlob(input);
  let sha256: string | undefined;
  if (input.size > 0 && input.size <= INSTANT_HASH_LIMIT) {
    const digest = await computeSha256(blob);
    sha256 = digest.length === 64 ? digest : undefined;
  }

  const result = await client.upload.init({
    connectionId: input.connectionId,
    parentId: input.parentId,
    fingerprint: input.fingerprint,
    originalName: input.name,
    mime: input.mime,
    size: input.size,
    sha256,
    relativePath: input.relativePath,
  });

  if (result.instant) {
    if (!result.fileNode) {
      throw new Error("秒传结果缺少文件节点");
    }
    return { instant: true, file: result.fileNode };
  }
  if (!result.uploadId) {
    throw new Error("上传初始化未返回会话标识");
  }
  return {
    instant: false,
    uploadId: result.uploadId,
    chunkSize: result.chunkSize,
    totalChunks: result.totalChunks,
    uploadedParts: result.uploadedParts ?? [],
    blob,
  };
});

const chunkPump = fromCallback<ItemEvent, PumpInput>(({ input, sendBack }) => {
  const controller = new AbortController();
  const done = new Set(input.uploadedParts);
  let uploadedBytes = input.startBytes;
  let nextIndex = 0;
  let failed = false;

  const uploadOne = async (index: number): Promise<void> => {
    const start = index * input.chunkSize;
    const end = Math.min((index + 1) * input.chunkSize, input.blob.size);
    const chunk = input.blob.slice(start, end);
    let attempt = 0;
    for (;;) {
      try {
        await uploadChunk({
          uploadId: input.uploadId,
          index,
          blob: chunk,
          signal: controller.signal,
        });
        return;
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }
        attempt += 1;
        if (attempt >= MAX_CHUNK_ATTEMPTS) {
          throw error;
        }
        await delay(Math.min(4000, 2 ** attempt * 250), controller.signal);
      }
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (controller.signal.aborted || failed) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= input.totalChunks) {
        return;
      }
      if (done.has(index)) {
        continue;
      }
      try {
        await uploadOne(index);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        failed = true;
        sendBack({
          type: "PUMP_ERROR",
          error: error instanceof Error ? error.message : "分片上传失败",
        });
        return;
      }
      done.add(index);
      const start = index * input.chunkSize;
      const end = Math.min((index + 1) * input.chunkSize, input.blob.size);
      uploadedBytes += end - start;
      sendBack({
        type: "CHUNK_ACK",
        index,
        bytes: uploadedBytes,
        uploadedParts: [...done].sort((a, b) => a - b),
      });
    }
  };

  const parallelism = Math.max(1, Math.min(input.maxParallelChunks, input.totalChunks));
  void Promise.all(Array.from({ length: parallelism }, () => worker()))
    .then(() => {
      if (!controller.signal.aborted && !failed) {
        sendBack({ type: "PUMP_DONE" });
      }
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted || failed) {
        return;
      }
      failed = true;
      sendBack({
        type: "PUMP_ERROR",
        error: error instanceof Error ? error.message : "分片上传失败",
      });
    });

  return () => controller.abort();
});

const finalizeUpload = fromPromise<FileNodeRow, { uploadId: string }>(async ({ input }) => {
  const result = await client.upload.complete({ uploadId: input.uploadId });
  if (!result.fileNode) {
    throw new Error("合并分片结果缺少文件节点");
  }
  return result.fileNode;
});

function persistItem(context: ItemContext, state: string): void {
  const session: PersistedSession = {
    fingerprint: context.fingerprint,
    uploadId: context.uploadId,
    name: context.name,
    size: context.size,
    mtime: context.mtime,
    mime: context.mime,
    parentId: context.parentId,
    relativePath: context.relativePath,
    carrier: context.carrier,
    state,
    updatedAt: Date.now(),
  };
  void putSession(session);
}

/** 终态清理：删除本地会话 / 句柄 / 副本，避免长期占配额（X1 §2）。 */
export function removePersisted(fingerprint: string): void {
  void deleteSession(fingerprint);
  void deleteHandle(fingerprint);
  void deleteBlob(fingerprint);
}

export const uploadItemMachine = setup({
  types: {
    context: {} as ItemContext,
    events: {} as ItemEvent,
    input: {} as ItemInput,
  },
  actors: {
    prepareSession,
    chunkPump,
    finalizeUpload,
  },
  actions: {
    persistQueued: ({ context }) => persistItem(context, "queued"),
    persistActive: ({ context }) => persistItem(context, "active"),
    persistPaused: ({ context }) => persistItem(context, "paused"),
    persistFailed: ({ context }) => persistItem(context, "failed"),
    cleanupPersisted: ({ context }) => removePersisted(context.fingerprint),
    abortRemote: ({ context }) => {
      if (context.uploadId) {
        void client.upload.abort({ uploadId: context.uploadId }).catch(() => undefined);
      }
    },
  },
}).createMachine({
  id: "uploadItem",
  initial: "queued",
  context: ({ input }) => ({
    fingerprint: input.fingerprint,
    name: input.name,
    size: input.size,
    mtime: input.mtime,
    mime: input.mime,
    parentId: input.parentId,
    connectionId: input.connectionId,
    relativePath: input.relativePath,
    source: input.source,
    handle: input.handle,
    blob: null,
    carrier: input.carrier,
    uploadId: null,
    chunkSize: 0,
    totalChunks: 0,
    uploadedParts: [],
    uploadedBytes: 0,
    file: null,
    progress: 0,
    error: null,
    maxParallelChunks: input.maxParallelChunks ?? DEFAULT_MAX_PARALLEL_CHUNKS,
  }),
  states: {
    queued: {
      id: "queued",
      entry: [
        "persistQueued",
        sendParent(({ context }) => ({ type: "CHILD_QUEUED", id: context.fingerprint })),
      ],
      on: {
        GRANT: { target: "#active" },
        PAUSE: { target: "#paused" },
        STOP: { target: "#canceled", actions: ["abortRemote", "cleanupPersisted"] },
      },
    },
    active: {
      id: "active",
      entry: [
        "persistActive",
        sendParent(({ context }) => ({ type: "CHILD_ACTIVE", id: context.fingerprint })),
      ],
      on: {
        PAUSE: { target: "#paused" },
        STOP: { target: "#canceled", actions: ["abortRemote", "cleanupPersisted"] },
        ERROR: { target: "#failed", actions: assign({ error: "上传失败" }) },
      },
      initial: "preparing",
      states: {
        preparing: {
          invoke: {
            src: "prepareSession",
            input: ({ context }) => ({
              fingerprint: context.fingerprint,
              name: context.name,
              size: context.size,
              mime: context.mime,
              parentId: context.parentId,
              connectionId: context.connectionId,
              relativePath: context.relativePath,
              source: context.source,
              handle: context.handle,
              carrier: context.carrier,
            }),
            onDone: [
              {
                guard: ({ event }) => event.output.instant,
                target: "#done",
                actions: assign(({ event }) => ({
                  file: event.output.instant ? event.output.file : null,
                  progress: 1,
                })),
              },
              {
                target: "transferring",
                actions: assign(({ event }) => {
                  if (event.output.instant) {
                    return {};
                  }
                  return {
                    uploadId: event.output.uploadId,
                    chunkSize: event.output.chunkSize,
                    totalChunks: event.output.totalChunks,
                    uploadedParts: event.output.uploadedParts,
                    blob: event.output.blob,
                  };
                }),
              },
            ],
            onError: {
              target: "#failed",
              actions: assign({
                error: ({ event }) =>
                  event.error instanceof Error ? event.error.message : "上传初始化失败",
              }),
            },
          },
        },
        transferring: {
          invoke: {
            src: "chunkPump",
            input: ({ context }) => ({
              uploadId: context.uploadId ?? "",
              blob: context.blob as Blob,
              chunkSize: context.chunkSize,
              totalChunks: context.totalChunks,
              uploadedParts: context.uploadedParts,
              startBytes: context.uploadedBytes,
              maxParallelChunks: context.maxParallelChunks,
            }),
          },
          on: {
            CHUNK_ACK: {
              actions: assign({
                uploadedBytes: ({ event }) => event.bytes,
                uploadedParts: ({ event }) => event.uploadedParts,
                progress: ({ context, event }) =>
                  context.size > 0 ? Math.min(1, event.bytes / context.size) : 0,
              }),
            },
            PUMP_DONE: { target: "merging" },
            PUMP_ERROR: {
              target: "#failed",
              actions: assign({ error: ({ event }) => event.error }),
            },
          },
        },
        merging: {
          invoke: {
            src: "finalizeUpload",
            input: ({ context }) => ({ uploadId: context.uploadId ?? "" }),
            onDone: {
              target: "#done",
              actions: assign({ file: ({ event }) => event.output, progress: 1 }),
            },
            onError: {
              target: "#failed",
              actions: assign({
                error: ({ event }) =>
                  event.error instanceof Error ? event.error.message : "合并分片失败",
              }),
            },
          },
        },
      },
    },
    paused: {
      id: "paused",
      entry: [
        "persistPaused",
        sendParent(({ context }) => ({ type: "CHILD_RELEASE", id: context.fingerprint })),
      ],
      on: {
        RESUME: { target: "#queued" },
        STOP: { target: "#canceled", actions: ["abortRemote", "cleanupPersisted"] },
      },
    },
    failed: {
      id: "failed",
      entry: [
        "persistFailed",
        sendParent(({ context }) => ({ type: "CHILD_RELEASE", id: context.fingerprint })),
      ],
      on: {
        RETRY: {
          target: "#queued",
          actions: assign({ error: null, progress: 0, uploadedBytes: 0 }),
        },
        STOP: { target: "#canceled", actions: ["abortRemote", "cleanupPersisted"] },
      },
    },
    done: {
      id: "done",
      type: "final",
      entry: [
        "cleanupPersisted",
        sendParent(({ context }) => ({ type: "CHILD_DONE", id: context.fingerprint })),
      ],
    },
    canceled: {
      id: "canceled",
      type: "final",
      entry: [
        "cleanupPersisted",
        sendParent(({ context }) => ({ type: "CHILD_CANCELED", id: context.fingerprint })),
      ],
    },
  },
});

export type UploadItemActorRef = ActorRefFrom<typeof uploadItemMachine>;
