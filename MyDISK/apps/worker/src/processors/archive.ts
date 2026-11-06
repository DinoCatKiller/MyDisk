import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { eq } from "drizzle-orm";

import { createDb, type Database } from "@MyDISK/db";
import { fileNode, storageConnection, task, type StorageConnectionRow } from "@MyDISK/db/schema";
import type { ArchiveJobData } from "@MyDISK/queue";
import { buildStorageKey, type StorageDriver } from "@MyDISK/storage";

import type { WorkerEnv } from "../env";
import { getProjectRoot } from "../env";
import { driverFor } from "../lib/driver";
import {
  archiveFormatOf,
  collectTree,
  ensureFolderPath,
  extOf,
  resolveUniqueName,
  safeEntryPath,
} from "../lib/archive-tree";
import { readTarGzEntries } from "../lib/tar-reader";
import { createZipStream } from "../lib/zip-writer";
import { openZipEntry, readZipEntries } from "../lib/zip-reader";

const MAX_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;

class TaskCancelledError extends Error {
  constructor() {
    super("任务已取消");
  }
}

function resolveStorageRoot(env: WorkerEnv): string {
  return env.STORAGE_ROOT.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(env.STORAGE_ROOT)
    ? env.STORAGE_ROOT
    : `${getProjectRoot()}/${env.STORAGE_ROOT}`;
}

async function updateProgress(db: Database, taskId: string, progress: number): Promise<void> {
  await db
    .update(task)
    .set({ progress: Math.max(0, Math.min(99, Math.round(progress))) })
    .where(eq(task.id, taskId));
}

async function assertActive(db: Database, taskId: string): Promise<void> {
  const rows = await db
    .select({ status: task.status })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  if (rows[0]?.status === "cancelled") {
    throw new TaskCancelledError();
  }
}

async function loadConnection(db: Database, connectionId: string): Promise<StorageConnectionRow> {
  const rows = await db
    .select()
    .from(storageConnection)
    .where(eq(storageConnection.id, connectionId))
    .limit(1);
  const connection = rows[0];
  if (!connection) {
    throw new Error("存储连接不存在");
  }
  return connection;
}

function toWebStream(iterable: AsyncIterable<Buffer>): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/* ------------------------------------------------------------------ */
/* 压缩 / 打包                                                          */
/* ------------------------------------------------------------------ */

async function runPack(
  db: Database,
  storageRoot: string,
  taskId: string,
  data: ArchiveJobData,
): Promise<Record<string, unknown>> {
  const entries = await collectTree(db, data.nodeIds);
  if (entries.length === 0) {
    throw new Error("没有可打包的文件");
  }
  const connectionId = entries[0]!.node.connectionId;
  const driver = driverFor(await loadConnection(db, connectionId), storageRoot);
  const name = data.name ?? `${entries[0]!.node.name}.zip`;
  const fileCount = entries.reduce(
    (total, entry) => (entry.node.type === "file" ? total + 1 : total),
    0,
  );

  let processed = 0;
  let bucket = -1;
  const sources = entries.map((entry) => ({
    name: entry.path,
    isDirectory: entry.node.type === "folder",
    open: async () => {
      await assertActive(db, taskId);
      processed += 1;
      const current = fileCount > 0 ? Math.floor(((processed / fileCount) * 90) / 10) : 0;
      if (current !== bucket) {
        bucket = current;
        await updateProgress(db, taskId, 5 + current * 10);
      }
      return driver.get(entry.node.storageKey);
    },
  }));

  const zip = createZipStream(sources);

  if (data.type === "package_download") {
    const storageKey = `_tasks/${taskId}/${name}`;
    const put = await driver.put(storageKey, zip, { contentType: "application/zip" });
    return { connectionId, storageKey, name, size: put.size };
  }

  const targetParentId = data.targetParentId ?? entries[0]!.node.parentId;
  const uniqueName = await resolveUniqueName(db, {
    connectionId,
    parentId: targetParentId ?? null,
    name,
  });
  const storageKey = buildStorageKey(connectionId, uniqueName);
  const put = await driver.put(storageKey, zip, { contentType: "application/zip" });
  const [created] = await db
    .insert(fileNode)
    .values({
      connectionId,
      parentId: targetParentId ?? null,
      ownerId: data.userId,
      type: "file",
      name: uniqueName,
      ext: "zip",
      mime: "application/zip",
      size: put.size,
      storageKey,
      status: "active",
    })
    .returning({ id: fileNode.id });
  if (!created) {
    throw new Error("写入压缩文件记录失败");
  }
  return { fileNodeId: created.id };
}

/* ------------------------------------------------------------------ */
/* 解压                                                                 */
/* ------------------------------------------------------------------ */

async function writeArchiveEntry(
  db: Database,
  driver: StorageDriver,
  context: {
    connectionId: string;
    ownerId: string;
    targetParentId: string | null;
    taskId: string;
  },
  entry: { path: string; stream?: ReadableStream<Uint8Array> },
): Promise<boolean> {
  const segments = entry.path.split("/");
  const folderId = await ensureFolderPath(db, {
    connectionId: context.connectionId,
    ownerId: context.ownerId,
    parentId: context.targetParentId,
    segments: segments.slice(0, -1),
  });
  const fileName = segments.at(-1)!;
  const uniqueName = await resolveUniqueName(db, {
    connectionId: context.connectionId,
    parentId: folderId,
    name: fileName,
  });
  const storageKey = buildStorageKey(context.connectionId, uniqueName);
  const put = await driver.put(storageKey, entry.stream ?? new ReadableStream(), {
    contentType: "application/octet-stream",
  });
  await db.insert(fileNode).values({
    connectionId: context.connectionId,
    parentId: folderId,
    ownerId: context.ownerId,
    type: "file",
    name: uniqueName,
    ext: extOf(uniqueName),
    size: put.size,
    storageKey,
    status: "active",
  });
  return true;
}

async function runExtract(
  db: Database,
  storageRoot: string,
  taskId: string,
  data: ArchiveJobData,
): Promise<Record<string, unknown>> {
  const archiveId = data.nodeIds[0];
  if (!archiveId) {
    throw new Error("缺少待解压文件");
  }
  const rows = await db.select().from(fileNode).where(eq(fileNode.id, archiveId)).limit(1);
  const node = rows[0];
  if (!node) {
    throw new Error("待解压文件不存在");
  }
  const format = archiveFormatOf(node.name);
  if (!format) {
    throw new Error("仅支持 zip / tar / tar.gz 压缩包");
  }

  const connection = await loadConnection(db, node.connectionId);
  const driver = driverFor(connection, storageRoot);
  const targetParentId = data.targetParentId ?? node.parentId ?? null;
  const context = {
    connectionId: node.connectionId,
    ownerId: data.userId,
    targetParentId,
    taskId,
  };

  const tmpDir = join(storageRoot, ".tmp", "tasks", taskId);
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  const extension = format === "zip" ? "zip" : format === "tar" ? "tar" : "tar.gz";
  const tmpFile = join(tmpDir, `archive.${extension}`);

  try {
    const archiveStream = await driver.get(node.storageKey);
    await pipeline(
      Readable.fromWeb(
        archiveStream as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
      ),
      createWriteStream(tmpFile),
    );
    await updateProgress(db, taskId, 10);

    let extracted = 0;
    let skipped = 0;
    let totalBytes = 0;

    if (format === "zip") {
      const entries = await readZipEntries(tmpFile);
      if (entries.length > MAX_ENTRIES) {
        throw new Error(`压缩包条目超过 ${MAX_ENTRIES} 个`);
      }
      const files = entries.filter((entry) => !entry.isDirectory).length;
      let processed = 0;

      for (const entry of entries) {
        await assertActive(db, taskId);
        const safe = safeEntryPath(entry.name);
        if (!safe) {
          skipped += 1;
          continue;
        }
        if (entry.isDirectory) {
          await ensureFolderPath(db, {
            connectionId: context.connectionId,
            ownerId: context.ownerId,
            parentId: context.targetParentId,
            segments: safe.split("/"),
          });
          continue;
        }
        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new Error("解压总大小超过 4GB");
        }
        await writeArchiveEntry(db, driver, context, {
          path: safe,
          stream: await openZipEntry(tmpFile, entry),
        });
        extracted += 1;
        processed += 1;
        if (files > 0) {
          await updateProgress(db, taskId, 10 + (processed / files) * 85);
        }
      }
    } else {
      let processed = 0;
      for await (const entry of readTarGzEntries(tmpFile)) {
        await assertActive(db, taskId);
        const safe = safeEntryPath(entry.name);
        if (!safe) {
          skipped += 1;
          continue;
        }
        if (entry.isDirectory) {
          await ensureFolderPath(db, {
            connectionId: context.connectionId,
            ownerId: context.ownerId,
            parentId: context.targetParentId,
            segments: safe.split("/"),
          });
          continue;
        }
        totalBytes += entry.size;
        if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new Error("解压总大小超过 4GB");
        }
        await writeArchiveEntry(db, driver, context, {
          path: safe,
          stream: toWebStream(entry.data),
        });
        extracted += 1;
        processed += 1;
        await updateProgress(db, taskId, Math.min(95, 10 + processed));
      }
    }

    if (extracted > MAX_ENTRIES) {
      throw new Error(`解压文件数超过 ${MAX_ENTRIES} 个`);
    }
    return { extracted, skipped };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* 入口                                                                 */
/* ------------------------------------------------------------------ */

export async function runArchive(env: WorkerEnv, data: ArchiveJobData): Promise<void> {
  const db = createDb({ DATABASE_URL: env.DATABASE_URL });
  const storageRoot = resolveStorageRoot(env);

  const rows = await db.select().from(task).where(eq(task.id, data.taskId)).limit(1);
  const current = rows[0];
  if (!current || current.status === "cancelled") {
    return;
  }

  await db
    .update(task)
    .set({ status: "running", progress: 2, startedAt: new Date(), error: null })
    .where(eq(task.id, data.taskId));

  try {
    const result =
      data.type === "extract"
        ? await runExtract(db, storageRoot, data.taskId, data)
        : await runPack(db, storageRoot, data.taskId, data);

    await db
      .update(task)
      .set({ status: "completed", progress: 100, result, finishedAt: new Date(), error: null })
      .where(eq(task.id, data.taskId));
  } catch (error) {
    if (error instanceof TaskCancelledError) {
      await db
        .update(task)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(task.id, data.taskId));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(task)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(task.id, data.taskId));
    throw error;
  }
}
