import { and, eq, inArray, isNull, ne } from "drizzle-orm";

import type { Database } from "@MyDISK/db";
import { fileNode, systemSetting } from "@MyDISK/db/schema";

/** 上传分片默认大小，system_setting.upload_chunk_size 可覆盖 */
export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const CHUNK_SIZE_KEY = "upload_chunk_size";

/** 读取系统设置里的分片大小，缺失或非法时回退默认值 */
export async function readChunkSize(db: Database, fallback: number): Promise<number> {
  const rows = await db
    .select({ value: systemSetting.value })
    .from(systemSetting)
    .where(eq(systemSetting.key, CHUNK_SIZE_KEY))
    .limit(1);
  const value = rows[0]?.value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

/** 小写扩展名（无扩展名返回 null） */
export function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  return name.slice(dot + 1).toLowerCase();
}

/** 去除文件名里的路径分隔符，避免把相对路径当成名字 */
export function basenameOf(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : normalized;
}

function withSuffix(name: string, index: number): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return `${name} (${index})`;
  }
  return `${name.slice(0, dot)} (${index})${name.slice(dot)}`;
}

/**
 * 同目录同名冲突时自动追加 ` (n)`（`A2` §5 唯一索引 + 后缀策略）。
 * `excludeId` 用于重命名时排除自身。
 */
export async function resolveUniqueName(
  db: Database,
  options: {
    connectionId: string;
    parentId: string | null;
    name: string;
    excludeId?: string;
  },
): Promise<string> {
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? options.name : withSuffix(options.name, index);
    const rows = await db
      .select({ id: fileNode.id })
      .from(fileNode)
      .where(
        and(
          eq(fileNode.connectionId, options.connectionId),
          options.parentId ? eq(fileNode.parentId, options.parentId) : isNull(fileNode.parentId),
          eq(fileNode.name, candidate),
          isNull(fileNode.deletedAt),
          options.excludeId ? ne(fileNode.id, options.excludeId) : undefined,
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      return candidate;
    }
  }
  return withSuffix(options.name, Date.now());
}

export type SubtreeNode = {
  id: string;
  connectionId: string;
  type: "file" | "folder";
  parentId: string | null;
  storageKey: string;
};

/**
 * 文件夹上传时按相对路径逐级补齐目录，返回最末一级目录 id。
 */
export async function ensureFolderPath(
  db: Database,
  options: {
    connectionId: string;
    ownerId: string;
    parentId: string | null;
    segments: string[];
  },
): Promise<string | null> {
  let parentId = options.parentId;
  for (const segment of options.segments) {
    const rows = await db
      .select({ id: fileNode.id })
      .from(fileNode)
      .where(
        and(
          eq(fileNode.connectionId, options.connectionId),
          parentId ? eq(fileNode.parentId, parentId) : isNull(fileNode.parentId),
          eq(fileNode.type, "folder"),
          eq(fileNode.name, segment),
          isNull(fileNode.deletedAt),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (found) {
      parentId = found.id;
      continue;
    }
    const name = await resolveUniqueName(db, {
      connectionId: options.connectionId,
      parentId,
      name: segment,
    });
    const [created] = await db
      .insert(fileNode)
      .values({
        connectionId: options.connectionId,
        parentId,
        ownerId: options.ownerId,
        type: "folder",
        name,
        storageKey: "",
        status: "active",
      })
      .returning({ id: fileNode.id });
    parentId = created?.id ?? null;
  }
  return parentId;
}

/** 收集若干根节点及其全部子孙（用于递归软删 / 还原 / 物理删除） */
export async function collectSubtree(db: Database, rootIds: string[]): Promise<SubtreeNode[]> {
  const collected = new Map<string, SubtreeNode>();
  let frontier = rootIds.filter(Boolean);
  while (frontier.length > 0) {
    const rows = await db
      .select({
        id: fileNode.id,
        connectionId: fileNode.connectionId,
        type: fileNode.type,
        parentId: fileNode.parentId,
        storageKey: fileNode.storageKey,
      })
      .from(fileNode)
      .where(inArray(fileNode.id, frontier));
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      if (!collected.has(row.id)) {
        collected.set(row.id, row);
      }
    }
    const children = await db
      .select({ id: fileNode.id })
      .from(fileNode)
      .where(
        inArray(
          fileNode.parentId,
          rows.map((row) => row.id),
        ),
      );
    frontier = children.map((child) => child.id).filter((id) => !collected.has(id));
  }
  return [...collected.values()];
}
