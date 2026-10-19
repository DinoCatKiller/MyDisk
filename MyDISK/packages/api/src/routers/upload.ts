import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import type { Database } from "@MyDISK/db";
import { fileNode, uploadSession } from "@MyDISK/db/schema";
import { buildStorageKey } from "@MyDISK/storage";

import { protectedProcedure } from "../procedure";
import { driverFor, resolveConnection } from "../lib/connections";
import {
  basenameOf,
  DEFAULT_CHUNK_SIZE,
  ensureFolderPath,
  extOf,
  readChunkSize,
  resolveUniqueName,
} from "../lib/files";
import { okSchema } from "../schemas/common";
import {
  chunkMetaInput,
  chunkMetaSchema,
  cleanupSchema,
  initUploadInput,
  uploadCompleteSchema,
  uploadIdInput,
  uploadInitSchema,
  uploadSessionArraySchema,
} from "../schemas/upload";

/** 校验目标目录：必须是同连接、未删除的文件夹 */
async function assertParentFolder(
  db: Database,
  connectionId: string,
  parentId: string | null | undefined,
): Promise<string | null> {
  if (!parentId) {
    return null;
  }
  const rows = await db
    .select({ id: fileNode.id, type: fileNode.type })
    .from(fileNode)
    .where(
      and(
        eq(fileNode.id, parentId),
        eq(fileNode.connectionId, connectionId),
        isNull(fileNode.deletedAt),
      ),
    )
    .limit(1);
  const folder = rows[0];
  if (!folder || folder.type !== "folder") {
    throw new ORPCError("NOT_FOUND", { message: "目标目录不存在" });
  }
  return folder.id;
}

/** 把 context 里的 storageRoot 与 db 一起用于驱动创建 */
function makeDriver(context: { storageRoot: string }, connection: Parameters<typeof driverFor>[0]) {
  return driverFor(connection, context.storageRoot);
}

const init = protectedProcedure
  .route({
    method: "POST",
    path: "/uploads/init",
    summary: "初始化上传会话",
    description: "同指纹复用会话实现断点续传；带 sha256 且命中同连接同哈希文件时秒传",
    tags: ["upload"],
  })
  .input(initUploadInput)
  .output(uploadInitSchema)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const connection = await resolveConnection(context.db, input.connectionId);

    const chunkSize = input.chunkSize ?? (await readChunkSize(context.db, DEFAULT_CHUNK_SIZE));
    const totalChunks = Math.max(1, Math.ceil(input.size / chunkSize));

    // 文件夹上传：按相对路径补齐中间目录，最终落点为其父目录
    const rawName = basenameOf(input.originalName);
    let parentId = await assertParentFolder(context.db, connection.id, input.parentId);
    if (input.relativePath) {
      const segments = input.relativePath
        .replace(/\\/g, "/")
        .split("/")
        .filter((segment) => segment && segment !== "." && segment !== "..");
      segments.pop();
      if (segments.length > 0) {
        parentId = await ensureFolderPath(context.db, {
          connectionId: connection.id,
          ownerId: userId,
          parentId,
          segments,
        });
      }
    }

    // 秒传：同连接、未删除、同哈希的文件 → 建引用记录
    if (input.sha256) {
      const hit = await context.db
        .select()
        .from(fileNode)
        .where(
          and(
            eq(fileNode.connectionId, connection.id),
            eq(fileNode.checksum, input.sha256),
            eq(fileNode.type, "file"),
            isNull(fileNode.deletedAt),
          ),
        )
        .limit(1);
      const source = hit[0];
      if (source) {
        const name = await resolveUniqueName(context.db, {
          connectionId: connection.id,
          parentId,
          name: rawName,
        });
        const [created] = await context.db
          .insert(fileNode)
          .values({
            connectionId: connection.id,
            parentId,
            ownerId: userId,
            type: "file",
            name,
            storageKey: source.storageKey,
            mime: input.mime ?? source.mime,
            ext: extOf(rawName),
            size: input.size,
            checksum: input.sha256,
            status: "active",
          })
          .returning();
        if (!created) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "秒传建引用失败" });
        }
        return { instant: true as const, fileNode: created };
      }
    }

    const existing = await context.db
      .select()
      .from(uploadSession)
      .where(
        and(eq(uploadSession.userId, userId), eq(uploadSession.fingerprint, input.fingerprint)),
      )
      .limit(1);

    const session = existing[0];
    if (
      session &&
      session.size === input.size &&
      session.chunkSize === chunkSize &&
      session.status !== "completed" &&
      session.status !== "aborted"
    ) {
      const [reused] = await context.db
        .update(uploadSession)
        .set({ status: "uploading", error: null, parentId })
        .where(eq(uploadSession.id, session.id))
        .returning();
      return {
        instant: false as const,
        uploadId: reused?.id ?? session.id,
        chunkSize: session.chunkSize,
        totalChunks: session.totalChunks,
        uploadedParts: reused?.uploadedParts ?? session.uploadedParts,
        providerUploadId: session.providerUploadId,
        storageKey: session.storageKey,
      };
    }

    if (session) {
      // 参数已变化或上次已结束：清理旧会话后重建
      if (session.providerUploadId) {
        await makeDriver(context, connection)
          .multipart?.abort(session.storageKey, session.providerUploadId)
          .catch(() => undefined);
      }
      await context.db.delete(uploadSession).where(eq(uploadSession.id, session.id));
    }

    const storageKey = buildStorageKey(connection.id, rawName);
    const driver = makeDriver(context, connection);
    if (!driver.multipart) {
      throw new ORPCError("NOT_IMPLEMENTED", { message: "该存储驱动不支持分片上传" });
    }
    const providerUploadId = await driver.multipart.init(storageKey);

    const [created] = await context.db
      .insert(uploadSession)
      .values({
        connectionId: connection.id,
        parentId,
        userId,
        fingerprint: input.fingerprint,
        originalName: rawName,
        relativePath: input.relativePath ?? null,
        mime: input.mime ?? null,
        size: input.size,
        chunkSize,
        totalChunks,
        uploadedParts: [],
        partsMeta: [],
        providerUploadId,
        storageKey,
        sha256: input.sha256 ?? null,
        status: "uploading",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    if (!created) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "创建上传会话失败" });
    }

    return {
      instant: false as const,
      uploadId: created.id,
      chunkSize,
      totalChunks,
      uploadedParts: [] as number[],
      providerUploadId,
      storageKey,
    };
  });

const complete = protectedProcedure
  .route({
    method: "POST",
    path: "/uploads/{uploadId}/complete",
    summary: "完成上传并合并分片",
    tags: ["upload"],
  })
  .input(uploadIdInput)
  .output(uploadCompleteSchema)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const rows = await context.db
      .select()
      .from(uploadSession)
      .where(and(eq(uploadSession.id, input.uploadId), eq(uploadSession.userId, userId)))
      .limit(1);
    const session = rows[0];
    if (!session) {
      throw new ORPCError("NOT_FOUND", { message: "上传会话不存在或已过期" });
    }

    const connection = await resolveConnection(context.db, session.connectionId);
    const driver = makeDriver(context, connection);
    if (!driver.multipart) {
      throw new ORPCError("NOT_IMPLEMENTED", { message: "该存储驱动不支持分片上传" });
    }

    // 幂等：已合并过则直接返回对应文件节点
    const existingNode = await context.db
      .select()
      .from(fileNode)
      .where(
        and(
          eq(fileNode.storageKey, session.storageKey),
          eq(fileNode.connectionId, session.connectionId),
          isNull(fileNode.deletedAt),
        ),
      )
      .limit(1);
    if (existingNode[0]) {
      await context.db.delete(uploadSession).where(eq(uploadSession.id, session.id));
      return { fileNode: existingNode[0] };
    }

    if (!session.providerUploadId) {
      throw new ORPCError("UPLOAD_SESSION_INVALID", { message: "上传会话缺少驱动 uploadId" });
    }

    const parts = await driver.multipart.listParts(session.storageKey, session.providerUploadId);
    if (parts.length < session.totalChunks) {
      throw new ORPCError("UPLOAD_SESSION_INVALID", {
        message: `分片不完整：已收到 ${parts.length}/${session.totalChunks}`,
      });
    }

    const result = await driver.multipart.complete(
      session.storageKey,
      session.providerUploadId,
      parts.map((partNumber) => ({ partNumber })),
    );

    const name = await resolveUniqueName(context.db, {
      connectionId: session.connectionId,
      parentId: session.parentId,
      name: session.originalName,
    });

    const [created] = await context.db
      .insert(fileNode)
      .values({
        connectionId: session.connectionId,
        parentId: session.parentId,
        ownerId: userId,
        type: "file",
        name,
        storageKey: session.storageKey,
        mime: session.mime,
        ext: extOf(session.originalName),
        size: result.size,
        checksum: result.etag ?? session.sha256,
        status: "active",
      })
      .returning();

    await context.db.delete(uploadSession).where(eq(uploadSession.id, session.id));
    if (!created) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "写入文件记录失败" });
    }
    return { fileNode: created };
  });

const abort = protectedProcedure
  .route({
    method: "POST",
    path: "/uploads/{uploadId}/abort",
    summary: "停止上传并清理临时分片",
    tags: ["upload"],
  })
  .input(uploadIdInput)
  .output(okSchema)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const rows = await context.db
      .select()
      .from(uploadSession)
      .where(and(eq(uploadSession.id, input.uploadId), eq(uploadSession.userId, userId)))
      .limit(1);
    const session = rows[0];
    if (!session) {
      return { ok: true };
    }
    const connection = await resolveConnection(context.db, session.connectionId);
    if (session.providerUploadId) {
      await makeDriver(context, connection)
        .multipart?.abort(session.storageKey, session.providerUploadId)
        .catch(() => undefined);
    }
    await context.db.delete(uploadSession).where(eq(uploadSession.id, session.id));
    return { ok: true };
  });

const setStatus = (status: "paused" | "uploading") =>
  protectedProcedure
    .route({
      method: "POST",
      path: `/uploads/{uploadId}/${status === "paused" ? "pause" : "resume"}`,
      summary: status === "paused" ? "标记上传暂停" : "标记上传继续",
      tags: ["upload"],
    })
    .input(uploadIdInput)
    .output(okSchema)
    .handler(async ({ input, context }) => {
      await context.db
        .update(uploadSession)
        .set({ status })
        .where(
          and(
            eq(uploadSession.id, input.uploadId),
            eq(uploadSession.userId, context.session.user.id),
          ),
        );
      return { ok: true };
    });

const pause = setStatus("paused");
const resume = setStatus("uploading");

const chunkMeta = protectedProcedure
  .route({
    method: "GET",
    path: "/uploads/{uploadId}/parts/{index}",
    summary: "查询单个分片是否已收到",
    tags: ["upload"],
  })
  .input(chunkMetaInput)
  .output(chunkMetaSchema)
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select()
      .from(uploadSession)
      .where(
        and(
          eq(uploadSession.id, input.uploadId),
          eq(uploadSession.userId, context.session.user.id),
        ),
      )
      .limit(1);
    const session = rows[0];
    if (!session) {
      return { received: false };
    }
    return { received: session.uploadedParts.includes(input.index) };
  });

const listPending = protectedProcedure
  .route({
    method: "GET",
    path: "/uploads/pending",
    summary: "列出未完成的上传会话",
    description: "用于浏览器刷新后重建上传队列",
    tags: ["upload"],
  })
  .output(uploadSessionArraySchema)
  .handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(uploadSession)
      .where(
        and(
          eq(uploadSession.userId, context.session.user.id),
          inArray(uploadSession.status, ["pending", "uploading", "paused", "failed"]),
        ),
      )
      .orderBy(uploadSession.updatedAt);
    return rows;
  });

const cleanupExpired = protectedProcedure
  .route({
    method: "POST",
    path: "/uploads/cleanup",
    summary: "清理过期上传会话",
    tags: ["upload"],
  })
  .output(cleanupSchema)
  .handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(uploadSession)
      .where(
        and(
          eq(uploadSession.userId, context.session.user.id),
          or(
            lt(uploadSession.expiresAt, new Date()),
            lt(uploadSession.updatedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
          ),
        ),
      );
    for (const session of rows) {
      if (session.providerUploadId) {
        try {
          const connection = await resolveConnection(context.db, session.connectionId);
          await makeDriver(context, connection)
            .multipart?.abort(session.storageKey, session.providerUploadId)
            .catch(() => undefined);
        } catch {
          // 连接已删除时直接丢弃会话
        }
      }
      await context.db.delete(uploadSession).where(eq(uploadSession.id, session.id));
    }
    return { cleaned: rows.length };
  });

export const uploadRouter = {
  init,
  complete,
  abort,
  pause,
  resume,
  chunkMeta,
  listPending,
  cleanupExpired,
};
