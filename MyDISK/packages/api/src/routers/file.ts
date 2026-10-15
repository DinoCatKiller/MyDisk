import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as z from "zod";

import type { Database } from "@MyDISK/db";
import { fileNode, shareLink } from "@MyDISK/db/schema";

import { protectedProcedure } from "../index";
import { driverFor, resolveConnection } from "../lib/connections";
import { collectSubtree, extOf, resolveUniqueName } from "../lib/files";

const paginationInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(50),
});

const sortInput = z.object({
  field: z.enum(["name", "size", "createdAt", "updatedAt", "type"]),
  order: z.enum(["asc", "desc"]),
});

const listInput = paginationInput.extend({
  connectionId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
  keyword: z.string().nullish(),
  type: z.enum(["file", "folder"]).nullish(),
  sort: sortInput.optional(),
});

const nodeIdInput = z.object({ nodeId: z.uuid() });
const nodeIdsInput = z.object({ nodeIds: z.array(z.uuid()).min(1) });

type Db = Database;

function orderBy(sort?: z.infer<typeof sortInput>) {
  const direction = sort?.order === "desc" ? desc : asc;
  switch (sort?.field) {
    case "size":
      return direction(fileNode.size);
    case "createdAt":
      return direction(fileNode.createdAt);
    case "updatedAt":
      return direction(fileNode.updatedAt);
    case "type":
      return direction(fileNode.type);
    default:
      return asc(fileNode.name);
  }
}

/** 取出若干节点（校验存在且未删除） */
async function requireNodes(db: Db, nodeIds: string[]) {
  const rows = await db
    .select()
    .from(fileNode)
    .where(and(inArray(fileNode.id, nodeIds), isNull(fileNode.deletedAt)));
  if (rows.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "文件不存在或已删除" });
  }
  return rows;
}

const list = protectedProcedure
  .route({
    method: "GET",
    path: "/files",
    summary: "列出目录内容",
    tags: ["file"],
  })
  .input(listInput)
  .handler(async ({ input, context }) => {
    const connection = await resolveConnection(context.db, input.connectionId);
    const where = and(
      eq(fileNode.connectionId, connection.id),
      input.parentId ? eq(fileNode.parentId, input.parentId) : isNull(fileNode.parentId),
      isNull(fileNode.deletedAt),
      input.type ? eq(fileNode.type, input.type) : undefined,
      input.keyword ? sql`${fileNode.name} ILIKE ${`%${input.keyword}%`}` : undefined,
    );

    const [totalRow] = await context.db.select({ value: count() }).from(fileNode).where(where);
    const items = await context.db
      .select()
      .from(fileNode)
      .where(where)
      .orderBy(desc(fileNode.type), orderBy(input.sort))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return {
      items,
      total: totalRow?.value ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  });

const tree = protectedProcedure
  .route({
    method: "GET",
    path: "/files/tree",
    summary: "列出子目录（惰性懒加载）",
    tags: ["file"],
  })
  .input(z.object({ connectionId: z.uuid().nullish(), parentId: z.uuid().nullish() }))
  .handler(async ({ input, context }) => {
    const connection = await resolveConnection(context.db, input.connectionId);
    return context.db
      .select()
      .from(fileNode)
      .where(
        and(
          eq(fileNode.connectionId, connection.id),
          input.parentId ? eq(fileNode.parentId, input.parentId) : isNull(fileNode.parentId),
          eq(fileNode.type, "folder"),
          isNull(fileNode.deletedAt),
        ),
      )
      .orderBy(asc(fileNode.name));
  });

const path = protectedProcedure
  .route({
    method: "GET",
    path: "/files/{nodeId}/path",
    summary: "面包屑祖先链",
    tags: ["file"],
  })
  .input(nodeIdInput)
  .handler(async ({ input, context }) => {
    const chain: (typeof fileNode.$inferSelect)[] = [];
    let currentId: string | null = input.nodeId;
    for (let depth = 0; currentId && depth < 100; depth += 1) {
      const rows: (typeof fileNode.$inferSelect)[] = await context.db
        .select()
        .from(fileNode)
        .where(eq(fileNode.id, currentId))
        .limit(1);
      const node = rows[0];
      if (!node) {
        break;
      }
      chain.unshift(node);
      currentId = node.parentId;
    }
    return chain;
  });

const get = protectedProcedure
  .route({ method: "GET", path: "/files/{nodeId}", summary: "获取单个节点", tags: ["file"] })
  .input(nodeIdInput)
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select()
      .from(fileNode)
      .where(eq(fileNode.id, input.nodeId))
      .limit(1);
    const node = rows[0];
    if (!node) {
      throw new ORPCError("NOT_FOUND", { message: "文件不存在" });
    }
    return node;
  });

const mkdir = protectedProcedure
  .route({ method: "POST", path: "/files/folders", summary: "新建文件夹", tags: ["file"] })
  .input(
    z.object({
      connectionId: z.uuid().nullish(),
      parentId: z.uuid().nullish(),
      name: z.string().min(1).max(255),
    }),
  )
  .handler(async ({ input, context }) => {
    const connection = await resolveConnection(context.db, input.connectionId);
    const name = await resolveUniqueName(context.db, {
      connectionId: connection.id,
      parentId: input.parentId ?? null,
      name: input.name,
    });
    const [created] = await context.db
      .insert(fileNode)
      .values({
        connectionId: connection.id,
        parentId: input.parentId ?? null,
        ownerId: context.session.user.id,
        type: "folder",
        name,
        storageKey: "",
        status: "active",
      })
      .returning();
    return created;
  });

const rename = protectedProcedure
  .route({
    method: "PATCH",
    path: "/files/{nodeId}",
    summary: "重命名（只改展示名，不动物理键）",
    tags: ["file"],
  })
  .input(z.object({ nodeId: z.uuid(), name: z.string().min(1).max(255) }))
  .handler(async ({ input, context }) => {
    const [node] = await requireNodes(context.db, [input.nodeId]);
    if (!node) {
      throw new ORPCError("NOT_FOUND", { message: "文件不存在" });
    }
    const name = await resolveUniqueName(context.db, {
      connectionId: node.connectionId,
      parentId: node.parentId,
      name: input.name,
      excludeId: node.id,
    });
    const [updated] = await context.db
      .update(fileNode)
      .set({ name, ext: node.type === "file" ? extOf(name) : node.ext })
      .where(eq(fileNode.id, node.id))
      .returning();
    return updated;
  });

const move = protectedProcedure
  .route({
    method: "POST",
    path: "/files/{nodeId}/move",
    summary: "移动节点到目标目录（P2 仅支持同连接）",
    tags: ["file"],
  })
  .input(z.object({ nodeIds: z.array(z.uuid()).min(1), targetParentId: z.uuid().nullish() }))
  .handler(async ({ input, context }) => {
    const nodes = await requireNodes(context.db, input.nodeIds);
    const connectionId = nodes[0]?.connectionId;
    if (!connectionId || nodes.some((node) => node.connectionId !== connectionId)) {
      throw new ORPCError("NOT_IMPLEMENTED", { message: "跨连接移动暂未支持" });
    }

    let targetParentId: string | null = input.targetParentId ?? null;
    if (targetParentId) {
      const target = await requireNodes(context.db, [targetParentId]);
      const folder = target[0];
      if (!folder || folder.type !== "folder" || folder.connectionId !== connectionId) {
        throw new ORPCError("NOT_FOUND", { message: "目标目录不存在" });
      }
      // 禁止移动到自身或自身子孙下，避免成环
      const subtree = await collectSubtree(context.db, input.nodeIds);
      if (subtree.some((node) => node.id === targetParentId)) {
        throw new ORPCError("BAD_REQUEST", { message: "不能移动到自身或其子目录" });
      }
    }

    for (const node of nodes) {
      const name = await resolveUniqueName(context.db, {
        connectionId,
        parentId: targetParentId,
        name: node.name,
        excludeId: node.id,
      });
      await context.db
        .update(fileNode)
        .set({ parentId: targetParentId, name })
        .where(eq(fileNode.id, node.id));
    }
    return { moved: nodes.length };
  });

const remove = protectedProcedure
  .route({
    method: "POST",
    path: "/files/remove",
    summary: "软删进回收站（递归）",
    tags: ["file"],
  })
  .input(nodeIdsInput)
  .handler(async ({ input, context }) => {
    const subtree = await collectSubtree(context.db, input.nodeIds);
    const ids = subtree.map((node) => node.id);
    if (ids.length === 0) {
      return { removed: 0 };
    }
    await context.db
      .update(fileNode)
      .set({
        deletedAt: new Date(),
        deletedBy: context.session.user.id,
        status: "trashed",
      })
      .where(and(inArray(fileNode.id, ids), isNull(fileNode.deletedAt)));
    return { removed: ids.length };
  });

const listTrash = protectedProcedure
  .route({ method: "GET", path: "/files/trash", summary: "回收站列表", tags: ["file"] })
  .input(paginationInput)
  .handler(async ({ input, context }) => {
    // 回收站只展示被直接删除的根条目（子孙跟随展示）
    const where = isNotNull(fileNode.deletedAt);
    const [totalRow] = await context.db.select({ value: count() }).from(fileNode).where(where);
    const items = await context.db
      .select()
      .from(fileNode)
      .where(where)
      .orderBy(desc(fileNode.deletedAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    return { items, total: totalRow?.value ?? 0, page: input.page, pageSize: input.pageSize };
  });

const restore = protectedProcedure
  .route({
    method: "POST",
    path: "/files/restore",
    summary: "从回收站还原（递归）",
    tags: ["file"],
  })
  .input(nodeIdsInput)
  .handler(async ({ input, context }) => {
    const subtree = await collectSubtree(context.db, input.nodeIds);
    const ids = subtree.map((node) => node.id);
    await context.db
      .update(fileNode)
      .set({ deletedAt: null, deletedBy: null, status: "active" })
      .where(and(inArray(fileNode.id, ids), isNotNull(fileNode.deletedAt)));
    return { restored: ids.length };
  });

/** 物理删除：先删存储对象，再删记录（同一物理键被多节点共享时保留对象） */
async function purgeNodes(context: { db: Db; storageRoot: string }, ids: string[]) {
  const subtree = await collectSubtree(context.db, ids);
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
    const refs = await context.db
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
      const connection = await resolveConnection(context.db, anchor.connectionId);
      const driver = driverFor(connection, context.storageRoot);
      await driver.deleteMany(purgeable).catch(() => undefined);
    }
  }

  // 先断父子引用，再删记录，避免自引用外键阻塞
  await context.db
    .update(fileNode)
    .set({ parentId: null })
    .where(inArray(fileNode.parentId, allIds));
  await context.db.delete(fileNode).where(inArray(fileNode.id, allIds));
  return allIds.length;
}

const purge = protectedProcedure
  .route({ method: "DELETE", path: "/files/purge", summary: "彻底删除", tags: ["file"] })
  .input(nodeIdsInput)
  .handler(async ({ input, context }) => ({ purged: await purgeNodes(context, input.nodeIds) }));

const emptyTrash = protectedProcedure
  .route({ method: "POST", path: "/files/trash/empty", summary: "清空回收站", tags: ["file"] })
  .handler(async ({ context }) => {
    const rows = await context.db
      .select({ id: fileNode.id })
      .from(fileNode)
      .where(isNotNull(fileNode.deletedAt));
    if (rows.length === 0) {
      return { purged: 0 };
    }
    return {
      purged: await purgeNodes(
        context,
        rows.map((row) => row.id),
      ),
    };
  });

const stats = protectedProcedure
  .route({ method: "GET", path: "/files/{nodeId}/stats", summary: "属性面板数据", tags: ["file"] })
  .input(nodeIdInput)
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select()
      .from(fileNode)
      .where(eq(fileNode.id, input.nodeId))
      .limit(1);
    const node = rows[0];
    if (!node) {
      throw new ORPCError("NOT_FOUND", { message: "文件不存在" });
    }
    const connection = await resolveConnection(context.db, node.connectionId);
    const [shareCountRow] = await context.db
      .select({ value: count() })
      .from(shareLink)
      .where(and(eq(shareLink.nodeId, node.id), eq(shareLink.status, "active")));

    return {
      node,
      connectionName: connection.name,
      storageKey: node.storageKey,
      shareCount: shareCountRow?.value ?? 0,
    };
  });

export const fileRouter = {
  list,
  tree,
  path,
  get,
  mkdir,
  rename,
  move,
  remove,
  listTrash,
  restore,
  purge,
  emptyTrash,
  stats,
};

export type FileRouterNode = typeof fileNode.$inferSelect;
