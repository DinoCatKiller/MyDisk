import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { driverFor, resolveConnection } from "@MyDISK/api/lib/connections";
import { verifyTaskRawToken } from "@MyDISK/api/lib/raw-token";
import { byteRangeHeaderSchema, rawNodeIdSchema, rawQuerySchema } from "@MyDISK/api/schemas/raw";
import { task } from "@MyDISK/db/schema";

import { serverConfig } from "../config";
import { env } from "../env.server";
import { getDb } from "../services";

/**
 * 打包下载产物取流：GET/HEAD /api/raw/task/:taskId?token=<签名>&dl=1
 * 产物是队列任务写入的临时对象（不在 file_node 中），因此单独一条二进制路由（`D3`）。
 */
export const taskRawRoute = new Hono();

taskRawRoute.on(["GET", "HEAD"], "/api/raw/task/:taskId", async (c) => {
  const taskId = rawNodeIdSchema.safeParse(c.req.param("taskId"));
  const query = rawQuerySchema.safeParse({
    token: c.req.query("token"),
    dl: c.req.query("dl"),
  });
  if (!query.success) {
    return c.json({ code: "BAD_REQUEST", message: "非法查询参数" }, 400);
  }
  if (!taskId.success) {
    return c.json({ code: "NOT_FOUND", message: "任务不存在" }, 404);
  }

  const payload = verifyTaskRawToken(query.data.token ?? "", env.BETTER_AUTH_SECRET);
  if (!payload) {
    return c.json({ code: "UNAUTHORIZED", message: "令牌无效或已过期" }, 401);
  }
  if (payload.taskId !== taskId.data) {
    return c.json({ code: "FORBIDDEN", message: "令牌与任务不匹配" }, 403);
  }

  const db = getDb();
  const rows = await db.select().from(task).where(eq(task.id, taskId.data)).limit(1);
  const row = rows[0];
  const result = row?.result as {
    storageKey?: unknown;
    connectionId?: unknown;
    name?: unknown;
  } | null;
  if (
    !row ||
    row.type !== "package_download" ||
    row.status !== "completed" ||
    !result ||
    typeof result.storageKey !== "string" ||
    typeof result.connectionId !== "string"
  ) {
    return c.json({ code: "NOT_FOUND", message: "打包产物不存在或尚未完成" }, 404);
  }

  const connection = await resolveConnection(db, result.connectionId);
  const driver = driverFor(connection, serverConfig.storageRoot);
  const stat = await driver.head(result.storageKey);
  if (!stat) {
    return c.json({ code: "STORAGE_UNREACHABLE", message: "打包产物缺失" }, 404);
  }

  const name = typeof result.name === "string" ? result.name : "download.zip";
  const total = stat.size;
  const encodedName = encodeURIComponent(name);
  const headers: Record<string, string> = {
    "Content-Type": "application/zip",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, max-age=0, must-revalidate",
  };

  const range = byteRangeHeaderSchema(total).safeParse(c.req.header("range"));
  if (!range.success) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  if (!range.data) {
    const responseHeaders = { ...headers, "Content-Length": `${total}` };
    if (c.req.method === "HEAD") {
      return new Response(null, { status: 200, headers: responseHeaders });
    }
    return new Response(await driver.get(result.storageKey), {
      status: 200,
      headers: responseHeaders,
    });
  }

  const { start, end } = range.data;
  const length = end - start + 1;
  const responseHeaders = {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Content-Length": `${length}`,
  };
  if (c.req.method === "HEAD") {
    return new Response(null, { status: 206, headers: responseHeaders });
  }
  const stream = await driver.get(result.storageKey, { start, end });
  return new Response(stream, { status: 206, headers: responseHeaders });
});
