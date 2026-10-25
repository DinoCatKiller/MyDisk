import { and, eq, isNotNull, lt } from "drizzle-orm";

import { createDb, type Database } from "@MyDISK/db";
import { driverFor } from "../lib/driver";
import { fileNode, storageConnection, systemSetting, uploadSession } from "@MyDISK/db/schema";

import type { WorkerEnv } from "../env";
import { getProjectRoot } from "../env";
import { purgeNodes } from "../lib/purge";

export type MaintenanceResult = {
  purgedTrashed: number;
  abortedSessions: number;
  gcTempDirs: number;
};

/** 读取 system_setting 的整型值（value 列为 jsonb），缺省回落 */
async function readIntSetting(db: Database, key: string, fallback: number): Promise<number> {
  const [row] = await db
    .select({ value: systemSetting.value })
    .from(systemSetting)
    .where(eq(systemSetting.key, key))
    .limit(1);
  const parsed = typeof row?.value === "number" ? row.value : Number(row?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * maintenance 队列（`A1` §4，定时 repeatable）：
 * 1. 回收站清理 —— `deleted_at` 超过保留期（system_setting `trash_retention_days`）
 *    的**顶层**被删条目物理删除（递归子树 + 存储对象引用计数）；
 * 2. 悬挂分片会话 —— `expires_at` 已过的 upload_session：云连接先 abort multipart 再删记录；
 * 3. 本地分片暂存 GC —— `<storageRoot>/.tmp/**` 下超期未活动的会话目录。
 */
export async function runMaintenance(env: WorkerEnv): Promise<MaintenanceResult> {
  const db = createDb({ DATABASE_URL: env.DATABASE_URL });
  const projectRoot = getProjectRoot();
  const storageRoot =
    env.STORAGE_ROOT.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(env.STORAGE_ROOT)
      ? env.STORAGE_ROOT
      : `${projectRoot}/${env.STORAGE_ROOT}`;
  const result: MaintenanceResult = { purgedTrashed: 0, abortedSessions: 0, gcTempDirs: 0 };

  // 1) 回收站清理：只取被删的顶层条目（父节点未被删除或不存在），子树随 purgeNodes 递归。
  //    数量为清理量级（默认 30 天一批），JS 侧过滤足够，避免 raw 别名 JOIN。
  const retentionDays = await readIntSetting(db, "trash_retention_days", env.TRASH_RETENTION_DAYS);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const expired = await db
    .select({ id: fileNode.id, parentId: fileNode.parentId })
    .from(fileNode)
    .where(and(isNotNull(fileNode.deletedAt), lt(fileNode.deletedAt, cutoff)));
  const deletedById = new Set(expired.map((row) => row.id));
  const expiredRoots = expired
    .filter((row) => row.parentId === null || !deletedById.has(row.parentId))
    .map((row) => row.id);
  result.purgedTrashed = await purgeNodes(db, storageRoot, env.ENCRYPTION_KEY, expiredRoots);

  // 2) 悬挂分片会话
  const stale = await db
    .select()
    .from(uploadSession)
    .where(lt(uploadSession.expiresAt, new Date()))
    .limit(500);
  for (const session of stale) {
    if (session.providerUploadId) {
      const [connection] = await db
        .select()
        .from(storageConnection)
        .where(eq(storageConnection.id, session.connectionId))
        .limit(1);
      if (connection && connection.type !== "local") {
        try {
          const driver = driverFor(connection, storageRoot, env.ENCRYPTION_KEY);
          await driver.multipart?.abort(session.storageKey, session.providerUploadId);
        } catch {
          // 云端 abort 失败不阻塞记录清理（对象生命周期策略兜底）
        }
      }
    }
    await db.delete(uploadSession).where(eq(uploadSession.id, session.id));
    result.abortedSessions += 1;
  }

  // 3) 本地分片暂存 GC
  result.gcTempDirs = await gcLocalTempParts(storageRoot, env.TMP_PART_MAX_AGE_HOURS);

  return result;
}

/** 本地驱动暂存分片 GC：`.tmp/<connectionId>/<uploadId>` 整目录按 mtime 过期删除 */
async function gcLocalTempParts(storageRoot: string, maxAgeHours: number): Promise<number> {
  const { readdir, rm, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const tmpRoot = join(storageRoot, ".tmp");
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  let removed = 0;
  let connections: string[];
  try {
    connections = await readdir(tmpRoot);
  } catch {
    return 0;
  }
  for (const connectionId of connections) {
    const connectionDir = join(tmpRoot, connectionId);
    let sessions: string[];
    try {
      sessions = await readdir(connectionDir);
    } catch {
      continue;
    }
    for (const uploadId of sessions) {
      const dir = join(connectionDir, uploadId);
      try {
        const info = await stat(dir);
        if (info.mtimeMs < cutoff) {
          await rm(dir, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        continue;
      }
    }
  }
  return removed;
}
