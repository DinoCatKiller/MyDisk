import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { ORPCError } from "@orpc/server";

import { driverFor, resolveConnection } from "@MyDISK/api/lib/connections";
import { isNodeWithinShare, loadShare, requireShareAccess } from "@MyDISK/api/lib/shares";
import { byteRangeHeaderSchema } from "@MyDISK/api/schemas/raw";
import { shareRawParamSchema, shareRawQuerySchema } from "@MyDISK/api/schemas/share";
import { fileNode, shareAccessLog, shareLink } from "@MyDISK/db/schema";

import { serverConfig } from "../config";
import { env } from "../env.server";
import { getDb } from "../services";

/**
 * 分享二进制面：GET/HEAD /api/raw/share/:token/:nodeId?access=&dl=1&inline=1
 *
 * 与 `/api/raw/:nodeId` 的区别：
 * - 鉴权凭公开分享 token +（有密码时）短时 access token，不依赖会话；
 * - 校验节点属于分享子树；
 * - 真正的全量 GET（无 Range）才递增 `download_count` 并写访问日志；
 * - 下载上限用原子条件更新，避免并发超额（`A6` §4）。
 */
export const shareRawRoute = new Hono();

function shareErrorResponse(error: unknown): Response {
  if (error instanceof ORPCError) {
    switch (error.code) {
      case "NOT_FOUND":
        return Response.json({ code: error.code, message: error.message }, { status: 404 });
      case "FORBIDDEN":
        return Response.json({ code: error.code, message: error.message }, { status: 403 });
      case "SHARE_PASSWORD_REQUIRED":
      case "INVALID_PASSWORD":
        return Response.json({ code: error.code, message: error.message }, { status: 401 });
      default:
        return Response.json({ code: error.code, message: error.message }, { status: 400 });
    }
  }
  return Response.json({ code: "INTERNAL_SERVER_ERROR", message: "取流失败" }, { status: 500 });
}

shareRawRoute.on(["GET", "HEAD"], "/api/raw/share/:token/:nodeId", async (c) => {
  const params = shareRawParamSchema.safeParse({
    token: c.req.param("token"),
    nodeId: c.req.param("nodeId"),
  });
  if (!params.success) {
    return c.json({ code: "NOT_FOUND", message: "分享或文件不存在" }, 404);
  }
  const query = shareRawQuerySchema.safeParse({
    access: c.req.query("access"),
    dl: c.req.query("dl"),
    inline: c.req.query("inline"),
  });
  if (!query.success) {
    return c.json({ code: "BAD_REQUEST", message: "非法查询参数" }, 400);
  }
  if (query.data.dl && query.data.inline) {
    return c.json({ code: "BAD_REQUEST", message: "dl 与 inline 不能同时使用" }, 400);
  }

  const db = getDb();
  let loaded;
  try {
    loaded = await loadShare(db, params.data.token);
    requireShareAccess(loaded.share, query.data.access, env.BETTER_AUTH_SECRET);
  } catch (error) {
    return shareErrorResponse(error);
  }

  const { share } = loaded;
  const nodeId = params.data.nodeId;
  const rows = await db
    .select()
    .from(fileNode)
    .where(and(eq(fileNode.id, nodeId), isNull(fileNode.deletedAt)))
    .limit(1);
  const node = rows[0];
  if (!node || node.type !== "file") {
    return c.json({ code: "NOT_FOUND", message: "文件不存在" }, 404);
  }
  if (!(await isNodeWithinShare(db, node.id, share.nodeId))) {
    return c.json({ code: "FORBIDDEN", message: "文件不在该分享范围内" }, 403);
  }

  const inline = query.data.inline === "1";
  if (inline ? !share.canPreview : !share.canDownload) {
    return c.json(
      { code: "FORBIDDEN", message: inline ? "该分享不允许预览" : "该分享不允许下载" },
      403,
    );
  }

  const isHead = c.req.method === "HEAD";
  const hasRange = c.req.header("range") !== undefined;
  if (!isHead && !hasRange) {
    // 原子占用一次下载额度；0 行 = 已被其他请求用尽
    const charged = await db
      .update(shareLink)
      .set({
        downloadCount: sql`${shareLink.downloadCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(
        and(
          eq(shareLink.id, share.id),
          or(
            isNull(shareLink.maxDownloads),
            sql`${shareLink.downloadCount} < ${shareLink.maxDownloads}`,
          ),
        ),
      )
      .returning({ id: shareLink.id });
    if (!charged[0]) {
      return c.json({ code: "FORBIDDEN", message: "分享下载次数已达上限" }, 403);
    }
    await db
      .insert(shareAccessLog)
      .values({
        shareId: share.id,
        action: "download",
        nodeId: node.id,
        ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: c.req.header("user-agent") ?? null,
      })
      .catch(() => undefined);
  }

  let driver;
  try {
    const connection = await resolveConnection(db, node.connectionId);
    driver = driverFor(connection, serverConfig.storageRoot);
  } catch (error) {
    return shareErrorResponse(error);
  }
  const stat = await driver.head(node.storageKey).catch(() => null);
  if (!stat) {
    return c.json({ code: "STORAGE_UNREACHABLE", message: "物理文件缺失" }, 404);
  }

  const total = stat.size;
  const encodedName = encodeURIComponent(node.name);
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`;
  const baseHeaders: Record<string, string> = {
    "Content-Type": node.mime ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Content-Disposition": disposition,
    "Cache-Control": "private, max-age=0, must-revalidate",
  };

  void db
    .update(fileNode)
    .set({ lastAccessedAt: new Date() })
    .where(eq(fileNode.id, node.id))
    .catch(() => undefined);

  const range = byteRangeHeaderSchema(total).safeParse(c.req.header("range"));
  if (!range.success) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  if (!range.data) {
    const headers = { ...baseHeaders, "Content-Length": `${total}` };
    if (isHead) {
      return new Response(null, { status: 200, headers });
    }
    const stream = await driver.get(node.storageKey);
    return new Response(stream, { status: 200, headers });
  }

  const { start, end } = range.data;
  const length = end - start + 1;
  const headers = {
    ...baseHeaders,
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Content-Length": `${length}`,
  };
  if (isHead) {
    return new Response(null, { status: 206, headers });
  }
  const stream = await driver.get(node.storageKey, { start, end });
  return new Response(stream, { status: 206, headers });
});
