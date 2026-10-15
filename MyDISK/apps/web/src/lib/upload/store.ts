/**
 * 上传队列的全局单例订阅层（连接 xstate 状态机与 SolidJS 响应式）。
 *
 * - `uploadActor` 在模块加载时立即 `start()`，不随组件 / 路由销毁，
 *   因此刷新到新页面时队列仍然存活。
 * - 用版本 signal 驱动响应式：池快照变化 + 每个子 actor 快照变化都会 bump。
 * - 对账：把本地 IndexedDB 会话与后端未完成会话比对，清理陈旧记录。
 */
import { createActor } from "xstate";
import { createSignal } from "solid-js";

import type { FileRouterNode } from "@MyDISK/api/routers/file";

import { client } from "~/utils/orpc";

import { fingerprintOf } from "./fingerprint";
import { listSessions } from "./idb";
import { removePersisted, type ItemInput, type UploadItemActorRef } from "./item.machine";
import { uploadPoolMachine } from "./pool.machine";

export type UploadItemStage =
  | "queued"
  | "preparing"
  | "transferring"
  | "merging"
  | "paused"
  | "failed"
  | "done"
  | "canceled";

export type UploadItemView = {
  id: string;
  name: string;
  size: number;
  stage: UploadItemStage;
  progress: number;
  uploadedBytes: number;
  error: string | null;
  file: FileRouterNode | null;
  parentId: string | null;
};

export type UploadSummary = {
  total: number;
  queued: number;
  active: number;
  paused: number;
  failed: number;
  done: number;
  progress: number;
};

/** 队列单例：模块级启动，跨组件 / 跨路由存活。 */
export const uploadActor = createActor(uploadPoolMachine, { input: {} }).start();

const [version, setVersion] = createSignal(0, { name: "upload-version", ownedWrite: true });
const [drawerOpen, setDrawerOpen] = createSignal(false, {
  name: "upload-drawer-open",
  ownedWrite: true,
});

function bump(): void {
  setVersion((current) => current + 1);
}

/** 子 actor 快照订阅表：随池内 items 增删同步维护。 */
const childSubs = new Map<string, () => void>();

function syncChildSubscriptions(): void {
  const items = uploadActor.getSnapshot().context.items as Map<string, UploadItemActorRef>;
  for (const [id, unsubscribe] of childSubs) {
    if (!items.has(id)) {
      unsubscribe();
      childSubs.delete(id);
    }
  }
  for (const [id, ref] of items) {
    if (!childSubs.has(id)) {
      const sub = ref.subscribe(() => bump());
      childSubs.set(id, () => sub.unsubscribe());
    }
  }
}

uploadActor.subscribe(() => {
  syncChildSubscriptions();
  bump();
});

function stageOf(snapshot: ReturnType<UploadItemActorRef["getSnapshot"]>): UploadItemStage {
  if (snapshot.matches("queued")) {
    return "queued";
  }
  if (snapshot.matches("paused")) {
    return "paused";
  }
  if (snapshot.matches("failed")) {
    return "failed";
  }
  if (snapshot.matches("done")) {
    return "done";
  }
  if (snapshot.matches("canceled")) {
    return "canceled";
  }
  if (snapshot.matches({ active: "transferring" })) {
    return "transferring";
  }
  if (snapshot.matches({ active: "merging" })) {
    return "merging";
  }
  if (snapshot.matches("active")) {
    return "preparing";
  }
  return "queued";
}

/** 当前队列快照（响应式）。 */
export function uploadItems(): UploadItemView[] {
  version();
  const items = uploadActor.getSnapshot().context.items as Map<string, UploadItemActorRef>;
  const out: UploadItemView[] = [];
  for (const [id, ref] of items) {
    const snapshot = ref.getSnapshot();
    const context = snapshot.context;
    out.push({
      id,
      name: context.name,
      size: context.size,
      stage: stageOf(snapshot),
      progress: context.progress,
      uploadedBytes: context.uploadedBytes,
      error: context.error,
      file: context.file,
      parentId: context.parentId,
    });
  }
  return out;
}

/** 队列聚合统计（响应式）。 */
export function uploadSummary(): UploadSummary {
  const items = uploadItems();
  const summary: UploadSummary = {
    total: items.length,
    queued: 0,
    active: 0,
    paused: 0,
    failed: 0,
    done: 0,
    progress: 0,
  };
  let bytes = 0;
  let doneBytes = 0;
  for (const item of items) {
    if (item.stage === "queued" || item.stage === "preparing") {
      summary.queued += 1;
    } else if (item.stage === "transferring" || item.stage === "merging") {
      summary.active += 1;
    } else if (item.stage === "paused") {
      summary.paused += 1;
    } else if (item.stage === "failed") {
      summary.failed += 1;
    } else if (item.stage === "done") {
      summary.done += 1;
    }
    bytes += item.size;
    if (item.stage === "done") {
      doneBytes += item.size;
    } else {
      doneBytes += item.uploadedBytes;
    }
  }
  summary.progress = bytes > 0 ? Math.min(1, doneBytes / bytes) : 0;
  return summary;
}

export const uploadDrawerOpen = drawerOpen;
export function openUploadDrawer(): void {
  setDrawerOpen(true);
}
export function closeUploadDrawer(): void {
  setDrawerOpen(false);
}
export function toggleUploadDrawer(): void {
  setDrawerOpen((open) => !open);
}

export type EnqueueOptions = {
  connectionId?: string | null;
  parentId?: string | null;
};

/** 待入队项：文件 + 可选的文件夹相对路径（拖拽目录时由 entry 遍历补齐）。 */
export type UploadCandidate = {
  file: File;
  relativePath?: string | null;
};

/** 将一批文件（或文件夹）加入上传队列。 */
export function enqueueFiles(files: Iterable<File>, options?: EnqueueOptions): Promise<void> {
  return enqueueCandidates(
    Array.from(files).map((file) => ({ file })),
    options,
  );
}

/** 将一批「文件 + 相对路径」候选加入上传队列。 */
export async function enqueueCandidates(
  candidates: Iterable<UploadCandidate>,
  options?: EnqueueOptions,
): Promise<void> {
  const list = Array.from(candidates);
  if (list.length === 0) {
    return;
  }
  const connectionId = options?.connectionId ?? null;
  const parentId = options?.parentId ?? null;

  const prepared = await Promise.all(
    list.map(async ({ file, relativePath: explicitPath }) => {
      const relativePath = explicitPath ?? (file.webkitRelativePath || null);
      const fingerprint = await fingerprintOf({
        name: file.name,
        size: file.size,
        mtime: file.lastModified,
        relativePath,
      });
      const input: ItemInput = {
        fingerprint,
        name: file.name,
        size: file.size,
        mtime: file.lastModified,
        mime: file.type || null,
        parentId,
        connectionId,
        relativePath,
        source: file,
        handle: null,
        carrier: "none",
      };
      return { fingerprint, input };
    }),
  );

  for (const { fingerprint, input } of prepared) {
    uploadActor.send({ type: "ENQUEUE", id: fingerprint, input });
  }
  setDrawerOpen(true);
}

export function pauseItem(id: string): void {
  uploadActor.send({ type: "ITEM_PAUSE", id });
}
export function resumeItem(id: string): void {
  uploadActor.send({ type: "ITEM_RESUME", id });
}
export function stopItem(id: string): void {
  uploadActor.send({ type: "ITEM_STOP", id });
}
export function retryItem(id: string): void {
  uploadActor.send({ type: "ITEM_RETRY", id });
}
export function pauseAll(): void {
  uploadActor.send({ type: "PAUSE_ALL" });
}
export function resumeAll(): void {
  uploadActor.send({ type: "RESUME_ALL" });
}
export function stopAll(): void {
  uploadActor.send({ type: "STOP_ALL" });
}
export function clearDone(): void {
  uploadActor.send({ type: "CLEAR_DONE" });
}

let initPromise: Promise<void> | null = null;

/** 幂等初始化：刷新后与后端未完成会话对账并清理陈旧本地记录（仅浏览器）。 */
export function initUploadStore(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  initPromise ??= reconcile();
  return initPromise;
}

async function reconcile(): Promise<void> {
  try {
    const [local, pending] = await Promise.all([listSessions(), client.upload.listPending()]);
    const remoteIds = new Set((pending as { id: string }[]).map((row) => row.id));
    for (const session of local) {
      if (session.uploadId && !remoteIds.has(session.uploadId)) {
        removePersisted(session.fingerprint);
      }
    }
  } catch {
    // 对账失败不阻塞页面
  }
}
