import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "@MyDISK/db";
import { fileNode } from "@MyDISK/db/schema";

export type FileNodeRow = typeof fileNode.$inferSelect;

export type TreeEntry = {
  node: FileNodeRow;
  /** zip 内相对路径（以根节点名开头，用 `/` 分隔） */
  path: string;
};

/** 按根节点顺序收集子树（含目录），children 目录优先、再按名称 */
export async function collectTree(db: Database, rootIds: string[]): Promise<TreeEntry[]> {
  const roots = await db.select().from(fileNode).where(inArray(fileNode.id, rootIds));
  const byId = new Map(roots.map((row) => [row.id, row]));
  const queue: TreeEntry[] = [];
  for (const id of rootIds) {
    const node = byId.get(id);
    if (node && !node.deletedAt) {
      queue.push({ node, path: node.name });
    }
  }

  const result: TreeEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    if (seen.has(current.node.id)) {
      continue;
    }
    seen.add(current.node.id);
    result.push(current);

    if (current.node.type === "folder") {
      const children = await db
        .select()
        .from(fileNode)
        .where(and(eq(fileNode.parentId, current.node.id), isNull(fileNode.deletedAt)))
        .orderBy(desc(fileNode.type), asc(fileNode.name));
      for (const child of children) {
        queue.push({ node: child, path: `${current.path}/${child.name}` });
      }
    }
  }
  return result;
}

/** 小写扩展名（无扩展名返回 null） */
export function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  return name.slice(dot + 1).toLowerCase();
}

/** 压缩包类型判定（解压只接受这些） */
export function archiveFormatOf(name: string): "zip" | "targz" | "tar" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return "targz";
  }
  if (lower.endsWith(".tar")) {
    return "tar";
  }
  return null;
}

/**
 * 清洗压缩包内条目名：拒绝绝对路径与 `..`，其余按 `/` 分层。
 * 返回 null 表示该条目应被丢弃。
 */
export function safeEntryPath(name: string): string | null {
  const normalized = name.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(normalized)) {
    return null;
  }
  const segments = normalized.split("/").filter((segment) => segment.trim().length > 0);
  if (segments.length === 0) {
    return null;
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

function withSuffix(name: string, index: number): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return `${name} (${index})`;
  }
  return `${name.slice(0, dot)} (${index})${name.slice(dot)}`;
}

/** 同目录同名冲突时追加 ` (n)`（与 `@MyDISK/api` 的 resolveUniqueName 同语义） */
export async function resolveUniqueName(
  db: Database,
  options: {
    connectionId: string;
    parentId: string | null;
    name: string;
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
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      return candidate;
    }
  }
  return withSuffix(options.name, Date.now());
}

/** 按相对路径逐级补齐目录，返回最末一级目录 id（与 api 侧同语义） */
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
    if (!created) {
      throw new Error(`创建目录失败: ${segment}`);
    }
    parentId = created.id;
  }
  return parentId;
}
