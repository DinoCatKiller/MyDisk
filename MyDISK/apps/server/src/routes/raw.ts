import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { driverFor, resolveConnection } from "@MyDISK/api/lib/connections";
import { verifyRawToken } from "@MyDISK/api/lib/raw-token";
import { byteRangeHeaderSchema, rawNodeIdSchema, rawQuerySchema } from "@MyDISK/api/schemas/raw";
import { fileNode } from "@MyDISK/db/schema";

import { serverConfig } from "../config";
import { env } from "../env.server";
import { auth, getDb } from "../services";

/**
 * 二进制面取流：GET/HEAD /api/raw/:nodeId?token=<签名>&dl=1&inline=1
 * 支持 Range → 206；不走 oRPC（`D3`），鉴权用短时签名令牌或会话 Cookie。
 * 路径 / query / Range 的校验复用 `@MyDISK/api/schemas/raw`（`A3` §7）。
 */
export const rawRoute = new Hono();

rawRoute.on(["GET", "HEAD"], "/api/raw/:nodeId", async (c) => {
  const nodeId = rawNodeIdSchema.safeParse(c.req.param("nodeId"));
  const query = rawQuerySchema.safeParse({
    token: c.req.query("token"),
    dl: c.req.query("dl"),
    inline: c.req.query("inline"),
  });
  if (!query.success) {
    return c.json({ code: "BAD_REQUEST", message: "非法查询参数" }, 400);
  }
  // 非 uuid 直接按「不存在」处理：既避免非法 id 打到 PG（invalid input syntax for uuid），也不泄漏 id 规则
  if (!nodeId.success) {
    return c.json({ code: "NOT_FOUND", message: "文件不存在" }, 404);
  }

  const { token, dl } = query.data;
  if (token) {
    // 令牌已绑定 nodeId，这里校验归属，防止令牌被挪用
    const payload = verifyRawToken(token, env.BETTER_AUTH_SECRET);
    if (!payload) {
      return c.json({ code: "UNAUTHORIZED", message: "令牌无效或已过期" }, 401);
    }
    if (payload.nodeId !== nodeId.data) {
      return c.json({ code: "FORBIDDEN", message: "令牌与资源不匹配" }, 403);
    }
  } else {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) {
      return c.json({ code: "UNAUTHORIZED", message: "未登录" }, 401);
    }
  }

  const db = getDb();
  const rows = await db.select().from(fileNode).where(eq(fileNode.id, nodeId.data)).limit(1);
  const node = rows[0];
  if (!node || node.type !== "file" || node.deletedAt) {
    return c.json({ code: "NOT_FOUND", message: "文件不存在" }, 404);
  }

  const connection = await resolveConnection(db, node.connectionId);
  const driver = driverFor(connection, serverConfig.storageRoot);
  const stat = await driver.head(node.storageKey);
  if (!stat) {
    return c.json({ code: "STORAGE_UNREACHABLE", message: "物理文件缺失" }, 404);
  }

  const total = stat.size;
  const encodedName = encodeURIComponent(node.name);
  const disposition = `${dl ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`;
  const baseHeaders: Record<string, string> = {
    "Content-Type": node.mime ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Content-Disposition": disposition,
    "Cache-Control": "private, max-age=0, must-revalidate",
  };

  // 记录最近访问时间（不阻塞取流）
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
    if (c.req.method === "HEAD") {
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
  if (c.req.method === "HEAD") {
    return new Response(null, { status: 206, headers });
  }
  const stream = await driver.get(node.storageKey, { start, end });
  return new Response(stream, { status: 206, headers });
});
