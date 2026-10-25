import { eq, inArray } from "drizzle-orm";

import type { Database } from "@MyDISK/db";
import { fileNode, storageConnection, type StorageConnectionRow } from "@MyDISK/db/schema";
import { driverFor } from "./driver";

/**
 * 物理删除节点子树（与 `@MyDISK/api` 的 `file.purge` 同语义）。
 *
 * worker 不依赖 `@MyDISK/api` 的路由面（`A1` §2.2 依赖方向只到 queue/storage/db/mail，
 * 这里仅复用其 `driverFor` 连接工具），故在此自持一份清理逻辑：
 * 先删存储对象（同一物理键被多节点共享时保留），再断父子引用、删记录。
 */
export async function purgeNodes(
  db: Database,
  storageRoot: string,
  encryptionKey: string | undefined,
  rootIds: string[],
): Promise<number> {
  if (rootIds.length === 0) {
    return 0;
  }
  const subtree = await collectSubtree(db, rootIds);
  const allIds = subtree.map((node) => node.id);
  if (allIds.length === 0) {
    return 0;
  }

  const fileKeys = [
    ...new Set(
      subtree
        .filter((node) => node.type === "file" && node.storageKey)
        .map((node) => node.storageKey),
    ),
  ];
  if (fileKeys.length > 0) {
    // 秒传产生的引用记录共享同一物理键，仅在最后一个引用被清除时才删对象
    const refs = await db
      .select({ storageKey: fileNode.storageKey })
      .from(fileNode)
      .where(inArray(fileNode.storageKey, fileKeys));
    const counts = new Map<string, number>();
    for (const ref of refs) {
      counts.set(ref.storageKey, (counts.get(ref.storageKey) ?? 0) + 1);
    }
    const purgeable = fileKeys.filter((key) => (counts.get(key) ?? 0) <= 1);
    const anchor = subtree[0];
    if (anchor && purgeable.length > 0) {
      const [connection] = await db
        .select()
        .from(storageConnection)
        .where(eq(storageConnection.id, anchor.connectionId))
        .limit(1);
      if (connection) {
        const driver = driverFor(connection as StorageConnectionRow, storageRoot, encryptionKey);
        await driver.deleteMany(purgeable).catch(() => undefined);
      }
    }
  }

  // 先断父子引用，再删记录，避免自引用外键阻塞
  await db.update(fileNode).set({ parentId: null }).where(inArray(fileNode.parentId, allIds));
  await db.delete(fileNode).where(inArray(fileNode.id, allIds));
  return allIds.length;
}

/** 递归收集节点子树（含自身；按层展开，防御性上限 10 万节点） */
async function collectSubtree(
  db: Database,
  rootIds: string[],
): Promise<(typeof fileNode.$inferSelect)[]> {
  const result: (typeof fileNode.$inferSelect)[] = [];
  const seen = new Set<string>();
  let frontier = rootIds;
  while (frontier.length > 0 && result.length <= 100_000) {
    const nodes = await db.select().from(fileNode).where(inArray(fileNode.id, frontier));
    result.push(...nodes);
    for (const node of nodes) {
      seen.add(node.id);
    }
    const children = await db
      .select({ id: fileNode.id })
      .from(fileNode)
      .where(inArray(fileNode.parentId, frontier));
    frontier = children.map((row) => row.id).filter((id) => !seen.has(id));
  }
  return result;
}
