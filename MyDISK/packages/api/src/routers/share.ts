import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import type { Database } from "@MyDISK/db";
import {
  fileNode,
  shareAccessLog,
  shareLink,
  type FileNodeRow,
  type ShareLinkRow,
} from "@MyDISK/db/schema";

import {
  generateShareToken,
  hashSharePassword,
  isNodeWithinShare,
  loadShare,
  publicShareNode,
  requireShareAccess,
  signShareAccessToken,
  verifySharePassword,
} from "../lib/shares";
import { protectedProcedure, publicProcedure } from "../procedure";
import { okSchema } from "../schemas/common";
import {
  publicShareDownloadInput,
  publicShareDownloadOutput,
  publicShareInfoInput,
  publicShareInfoSchema,
  publicShareListInput,
  publicShareListSchema,
  publicShareUnlockInput,
  publicShareUnlockOutput,
  publicShareSchema,
  shareAccessLogInput,
  shareAccessLogListSchema,
  shareCreateInput,
  shareCreateOutput,
  shareIdInput,
  shareListInput,
  shareListSchema,
  shareUpdateInput,
  type PublicShare,
} from "../schemas/share";

type Db = Database;

type SessionUser = { id: string; role?: string | null };

function assertOwner(share: ShareLinkRow, user: SessionUser): void {
  if (share.createdBy !== user.id && user.role !== "founder") {
    throw new ORPCError("FORBIDDEN", { message: "只有分享创建者或创始人可以执行该操作" });
  }
}

function toPublicShare(share: ShareLinkRow, node: FileNodeRow): PublicShare {
  return publicShareSchema.parse({
    id: share.id,
    token: share.token,
    nodeId: share.nodeId,
    nodeName: node.name,
    nodeType: node.type,
    nodeSize: node.size,
    hasPassword: share.passwordHash !== null,
    expiresAt: share.expiresAt,
    maxDownloads: share.maxDownloads,
    downloadCount: share.downloadCount,
    canPreview: share.canPreview,
    canDownload: share.canDownload,
    canList: share.canList,
    status: share.status,
    lastAccessedAt: share.lastAccessedAt,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  });
}

async function requireShareRow(db: Db, id: string): Promise<ShareLinkRow> {
  const rows = await db.select().from(shareLink).where(eq(shareLink.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "分享不存在" });
  }
  return row;
}

function ensureFuture(expiresAt: Date | null | undefined): void {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ORPCError("BAD_REQUEST", { message: "有效期必须晚于当前时间" });
  }
}

/** 访问日志：失败不影响主流程（公开路径不因审计失败而不可用） */
async function writeAccessLog(
  db: Db,
  shareId: string,
  action: "view" | "download" | "password_fail",
  nodeId: string | null,
  requestInfo: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await db
    .insert(shareAccessLog)
    .values({
      shareId,
      action,
      nodeId,
      ip: requestInfo.ip,
      userAgent: requestInfo.userAgent,
    })
    .catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* 管理端                                                              */
/* ------------------------------------------------------------------ */

const create = protectedProcedure
  .route({ method: "POST", path: "/shares", summary: "创建分享链接", tags: ["share"] })
  .input(shareCreateInput)
  .output(shareCreateOutput)
  .handler(async ({ input, context }) => {
    ensureFuture(input.expiresAt);

    const nodeRows = await context.db
      .select()
      .from(fileNode)
      .where(and(eq(fileNode.id, input.nodeId), isNull(fileNode.deletedAt)))
      .limit(1);
    if (!nodeRows[0]) {
      throw new ORPCError("NOT_FOUND", { message: "分享目标不存在或已删除" });
    }

    let token = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateShareToken();
      const exists = await context.db
        .select({ id: shareLink.id })
        .from(shareLink)
        .where(eq(shareLink.token, candidate))
        .limit(1);
      if (!exists[0]) {
        token = candidate;
        break;
      }
    }
    if (!token) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "生成分享短码失败，请重试" });
    }

    const password = input.password ?? null;
    const rows = await context.db
      .insert(shareLink)
      .values({
        token,
        nodeId: input.nodeId,
        createdBy: context.user.id,
        passwordHash: password ? hashSharePassword(password) : null,
        expiresAt: input.expiresAt ?? null,
        maxDownloads: input.maxDownloads ?? null,
        canPreview: input.canPreview,
        canDownload: input.canDownload,
        canList: input.canList,
      })
      .returning();

    if (!rows[0]) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "创建分享失败" });
    }
    return { token, url: `/share/${token}` };
  });

const list = protectedProcedure
  .route({ method: "GET", path: "/shares", summary: "分享链接列表", tags: ["share"] })
  .input(shareListInput)
  .output(shareListSchema)
  .handler(async ({ input, context }) => {
    const where = input.nodeId ? eq(shareLink.nodeId, input.nodeId) : undefined;
    const [totalRow] = await context.db.select({ value: count() }).from(shareLink).where(where);

    const rows = await context.db
      .select({ share: shareLink, node: fileNode })
      .from(shareLink)
      .innerJoin(fileNode, eq(shareLink.nodeId, fileNode.id))
      .where(where)
      .orderBy(desc(shareLink.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return {
      items: rows.map((row) => toPublicShare(row.share, row.node)),
      total: totalRow?.value ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  });

const update = protectedProcedure
  .route({ method: "PATCH", path: "/shares/{id}", summary: "修改分享限制", tags: ["share"] })
  .input(shareUpdateInput)
  .output(publicShareSchema)
  .handler(async ({ input, context }) => {
    const current = await requireShareRow(context.db, input.id);
    assertOwner(current, context.user);
    ensureFuture(input.expiresAt);

    const updated = await context.db
      .update(shareLink)
      .set({
        ...(input.password !== undefined
          ? { passwordHash: input.password === null ? null : hashSharePassword(input.password) }
          : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        ...(input.maxDownloads !== undefined ? { maxDownloads: input.maxDownloads } : {}),
        ...(input.canPreview !== undefined ? { canPreview: input.canPreview } : {}),
        ...(input.canDownload !== undefined ? { canDownload: input.canDownload } : {}),
        ...(input.canList !== undefined ? { canList: input.canList } : {}),
        // 已过期且有效期/上限被更新 → 恢复 active；已撤销的分享永不自动恢复
        ...(current.status === "expired" &&
        (input.expiresAt !== undefined || input.maxDownloads !== undefined)
          ? { status: "active" as const }
          : {}),
      })
      .where(eq(shareLink.id, input.id))
      .returning();

    const share = updated[0];
    if (!share) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "更新分享失败" });
    }
    const nodeRows = await context.db
      .select()
      .from(fileNode)
      .where(eq(fileNode.id, share.nodeId))
      .limit(1);
    if (!nodeRows[0]) {
      throw new ORPCError("NOT_FOUND", { message: "分享目标已不存在" });
    }
    return toPublicShare(share, nodeRows[0]);
  });

const revoke = protectedProcedure
  .route({ method: "POST", path: "/shares/{id}/revoke", summary: "撤销分享", tags: ["share"] })
  .input(shareIdInput)
  .output(okSchema)
  .handler(async ({ input, context }) => {
    const current = await requireShareRow(context.db, input.id);
    assertOwner(current, context.user);
    await context.db.update(shareLink).set({ status: "revoked" }).where(eq(shareLink.id, input.id));
    return { ok: true };
  });

const accessLog = protectedProcedure
  .route({
    method: "GET",
    path: "/shares/{id}/access-log",
    summary: "分享访问日志",
    tags: ["share"],
  })
  .input(shareAccessLogInput)
  .output(shareAccessLogListSchema)
  .handler(async ({ input, context }) => {
    const current = await requireShareRow(context.db, input.id);
    assertOwner(current, context.user);

    const where = eq(shareAccessLog.shareId, input.id);
    const [totalRow] = await context.db
      .select({ value: count() })
      .from(shareAccessLog)
      .where(where);
    const items = await context.db
      .select()
      .from(shareAccessLog)
      .where(where)
      .orderBy(desc(shareAccessLog.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return {
      items,
      total: totalRow?.value ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  });

/* ------------------------------------------------------------------ */
/* 公开端（无登录）                                                    */
/* ------------------------------------------------------------------ */

const publicInfo = publicProcedure
  .route({
    method: "GET",
    path: "/public/shares/{token}",
    summary: "公开分享信息",
    tags: ["share"],
  })
  .input(publicShareInfoInput)
  .output(publicShareInfoSchema)
  .handler(async ({ input, context }) => {
    const { share, node } = await loadShare(context.db, input.token);
    await writeAccessLog(context.db, share.id, "view", null, context.requestInfo);

    return {
      rootNodeId: node.id,
      node: { name: node.name, type: node.type, size: node.size, mime: node.mime },
      needPassword: share.passwordHash !== null,
      canPreview: share.canPreview,
      canDownload: share.canDownload,
      canList: share.canList,
      expiresAt: share.expiresAt,
    };
  });

const publicUnlock = publicProcedure
  .route({
    method: "POST",
    path: "/public/shares/{token}/unlock",
    summary: "分享密码解锁",
    tags: ["share"],
  })
  .input(publicShareUnlockInput)
  .output(publicShareUnlockOutput)
  .handler(async ({ input, context }) => {
    const { share } = await loadShare(context.db, input.token);

    if (!share.passwordHash) {
      return { shareToken: signShareAccessToken(share.id, context.signingSecret) };
    }
    if (!verifySharePassword(input.password, share.passwordHash)) {
      await writeAccessLog(context.db, share.id, "password_fail", null, context.requestInfo);
      throw new ORPCError("INVALID_PASSWORD", { message: "密码不正确" });
    }
    return { shareToken: signShareAccessToken(share.id, context.signingSecret) };
  });

const publicList = publicProcedure
  .route({
    method: "GET",
    path: "/public/shares/{token}/files",
    summary: "公开分享列目录",
    tags: ["share"],
  })
  .input(publicShareListInput)
  .output(publicShareListSchema)
  .handler(async ({ input, context }) => {
    const { share, node } = await loadShare(context.db, input.token);
    requireShareAccess(share, input.shareToken, context.signingSecret);
    await writeAccessLog(context.db, share.id, "view", null, context.requestInfo);

    if (node.type === "file") {
      return { items: [publicShareNode(node)], total: 1, page: 1, pageSize: 1 };
    }
    if (!share.canList) {
      throw new ORPCError("FORBIDDEN", { message: "该分享不允许浏览目录" });
    }

    let parentId = node.id;
    if (input.parentNodeId) {
      if (!(await isNodeWithinShare(context.db, input.parentNodeId, node.id))) {
        throw new ORPCError("NOT_FOUND", { message: "目录不存在" });
      }
      const parentRows = await context.db
        .select()
        .from(fileNode)
        .where(eq(fileNode.id, input.parentNodeId))
        .limit(1);
      if (!parentRows[0] || parentRows[0].type !== "folder") {
        throw new ORPCError("NOT_FOUND", { message: "目录不存在" });
      }
      parentId = input.parentNodeId;
    }

    const where = and(eq(fileNode.parentId, parentId), isNull(fileNode.deletedAt));
    const [totalRow] = await context.db.select({ value: count() }).from(fileNode).where(where);
    const rows = await context.db
      .select()
      .from(fileNode)
      .where(where)
      .orderBy(desc(fileNode.type), asc(fileNode.name))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return {
      items: rows.map(publicShareNode),
      total: totalRow?.value ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  });

const publicDownloadUrl = publicProcedure
  .route({
    method: "POST",
    path: "/public/shares/{token}/download-url",
    summary: "公开分享下载 / 预览地址",
    tags: ["share"],
  })
  .input(publicShareDownloadInput)
  .output(publicShareDownloadOutput)
  .handler(async ({ input, context }) => {
    const { share, node } = await loadShare(context.db, input.token);
    requireShareAccess(share, input.shareToken, context.signingSecret);

    const targetId = input.nodeId ?? node.id;
    const rows = await context.db
      .select()
      .from(fileNode)
      .where(and(eq(fileNode.id, targetId), isNull(fileNode.deletedAt)))
      .limit(1);
    const target = rows[0];
    if (!target || target.type !== "file") {
      throw new ORPCError("NOT_FOUND", { message: "文件不存在或已删除" });
    }
    if (!(await isNodeWithinShare(context.db, target.id, node.id))) {
      throw new ORPCError("FORBIDDEN", { message: "文件不在该分享范围内" });
    }

    const inline = input.inline;
    if (inline ? !share.canPreview : !share.canDownload) {
      throw new ORPCError("FORBIDDEN", {
        message: inline ? "该分享不允许预览" : "该分享不允许下载",
      });
    }

    const params = new URLSearchParams();
    if (inline) {
      params.set("inline", "1");
    } else {
      params.set("dl", "1");
    }
    if (input.shareToken) {
      params.set("access", input.shareToken);
    }
    return { url: `/api/raw/share/${share.token}/${target.id}?${params.toString()}` };
  });

export const shareRouter = {
  create,
  list,
  update,
  revoke,
  accessLog,
  public: {
    info: publicInfo,
    unlock: publicUnlock,
    list: publicList,
    downloadUrl: publicDownloadUrl,
  },
};
