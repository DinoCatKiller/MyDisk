import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { driverFor, resolveConnection } from "@MyDISK/api/lib/connections";
import { verifyRawToken } from "@MyDISK/api/lib/raw-token";
import { fileNode } from "@MyDISK/db/schema";

import { serverConfig } from "../config";
import { env } from "../env.server";
import { auth, getDb } from "../services";

/**
 * 二进制面取流：GET/HEAD /api/raw/:nodeId?token=<签名>&dl=1&inline=1
 * 支持 Range → 206；不走 oRPC（`D3`），鉴权用短时签名令牌或会话 Cookie。
 */
export const rawRoute = new Hono();

type ByteRange = { start: number; end: number };

/** 解析单段 Range；返回 null 表示无 Range，返回 "unsatisfiable" 表示非法区间 */
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return "unsatisfiable";
  }
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") {
    return "unsatisfiable";
  }

  if (rawStart === "") {
    // 后缀区间：bytes=-N 表示最后 N 字节
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return "unsatisfiable";
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) {
    return "unsatisfiable";
  }
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) {
    return "unsatisfiable";
  }
  return { start, end };
}

rawRoute.on(["GET", "HEAD"], "/api/raw/:nodeId", async (c) => {
  const nodeId = c.req.param("nodeId");
  const token = c.req.query("token");
  if (token) {
    // 令牌已绑定 nodeId，这里校验归属，防止令牌被挪用
    const payload = verifyRawToken(token, env.BETTER_AUTH_SECRET);
    if (!payload) {
      return c.json({ code: "UNAUTHORIZED", message: "令牌无效或已过期" }, 401);
    }
    if (payload.nodeId !== nodeId) {
      return c.json({ code: "FORBIDDEN", message: "令牌与资源不匹配" }, 403);
    }
  } else {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) {
      return c.json({ code: "UNAUTHORIZED", message: "未登录" }, 401);
    }
  }

  const db = getDb();
  const rows = await db.select().from(fileNode).where(eq(fileNode.id, nodeId)).limit(1);
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
  const disposition = `${c.req.query("dl") === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`;
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

  const range = parseRange(c.req.header("range") ?? null, total);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  if (!range) {
    const headers = { ...baseHeaders, "Content-Length": `${total}` };
    if (c.req.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    const stream = await driver.get(node.storageKey);
    return new Response(stream, { status: 200, headers });
  }

  const length = range.end - range.start + 1;
  const headers = {
    ...baseHeaders,
    "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
    "Content-Length": `${length}`,
  };
  if (c.req.method === "HEAD") {
    return new Response(null, { status: 206, headers });
  }
  const stream = await driver.get(node.storageKey, { start: range.start, end: range.end });
  return new Response(stream, { status: 206, headers });
});
