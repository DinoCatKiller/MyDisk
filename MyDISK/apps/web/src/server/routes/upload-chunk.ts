import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { driverFor, resolveConnection } from "@MyDISK/api/lib/connections";
import { uploadChunkQuery } from "@MyDISK/api/schemas/upload";
import { uploadSession } from "@MyDISK/db/schema";

import { serverConfig } from "../config";
import { auth, getDb } from "../services";

/**
 * 二进制面上传：POST /api/upload/chunk?uploadId=<sessionId>&index=<n>
 * body 为原始分片流（application/octet-stream），不走 oRPC（`D3`）。
 * 路径自带 `/api` 前缀（`GUI` §4 / `D8`）。
 */
export const uploadChunkRoute = new Hono();

uploadChunkRoute.post("/api/upload/chunk", async (c) => {
  const db = getDb();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ code: "UNAUTHORIZED", message: "未登录" }, 401);
  }

  // query 校验与 oRPC 侧共用同一份 schema（`A3` §7）；uuid 校验可挡住会打到 PG 的非法 id
  const parsed = uploadChunkQuery.safeParse({
    uploadId: c.req.query("uploadId"),
    index: c.req.query("index"),
  });
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: "缺少或非法的 uploadId / index" }, 400);
  }
  const { uploadId, index } = parsed.data;

  const rows = await db.select().from(uploadSession).where(eq(uploadSession.id, uploadId)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== session.user.id) {
    return c.json({ code: "NOT_FOUND", message: "上传会话不存在" }, 404);
  }
  if (row.status === "completed" || row.status === "aborted") {
    return c.json({ code: "UPLOAD_SESSION_EXPIRED", message: "上传会话已结束" }, 409);
  }
  if (index >= row.totalChunks) {
    return c.json({ code: "BAD_REQUEST", message: "分片序号越界" }, 400);
  }
  if (!row.providerUploadId) {
    return c.json({ code: "UPLOAD_SESSION_INVALID", message: "上传会话缺少驱动 uploadId" }, 500);
  }

  const body = c.req.raw.body;
  if (!body) {
    return c.json({ code: "BAD_REQUEST", message: "缺少请求体" }, 400);
  }

  // 客户端可能中途 abort（暂停/停止上传）：先在 try/catch 里把分片读进内存，
  // 避免中断的请求流以 ECONNRESET 沿 node 流逃逸、把单 app 进程打挂。
  // 8MB 分片缓冲内存可控；读完再以流交驱动，行为与原先一致。
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await c.req.arrayBuffer());
  } catch {
    return c.json({ code: "CLIENT_ABORTED", message: "客户端中断了分片上传" }, 400);
  }

  const connection = await resolveConnection(db, row.connectionId);
  const driver = driverFor(connection, serverConfig.storageRoot);
  if (!driver.multipart) {
    return c.json({ code: "NOT_IMPLEMENTED", message: "该存储驱动不支持分片上传" }, 501);
  }

  const { etag } = await driver.multipart.uploadPart(
    row.storageKey,
    row.providerUploadId,
    index,
    new Blob([bytes]).stream(),
  );

  // 单语句原子追加，避免并发分片互相覆盖（元素去重）
  await db
    .update(uploadSession)
    .set({
      uploadedParts: sql`CASE WHEN ${uploadSession.uploadedParts} @> ${JSON.stringify([index])}::jsonb THEN ${uploadSession.uploadedParts} ELSE ${uploadSession.uploadedParts} || ${JSON.stringify([index])}::jsonb END`,
      status: "uploading",
      updatedAt: new Date(),
    })
    .where(eq(uploadSession.id, uploadId));

  return c.json({ received: index, etag });
});
