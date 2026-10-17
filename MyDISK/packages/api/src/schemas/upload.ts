import * as z from "zod";

import { uploadStatusEnum } from "@MyDISK/db/schema";

import { queryIntSchema } from "./common";
import { fileNodeSchema } from "./file";

export const fingerprintSchema = z.string().min(8).max(256);

export const initUploadInput = z.object({
  connectionId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
  fingerprint: fingerprintSchema,
  originalName: z.string().min(1),
  mime: z.string().nullish(),
  size: z.number().int().nonnegative(),
  chunkSize: z.number().int().positive().nullish(),
  sha256: z.string().length(64).nullish(),
  relativePath: z.string().nullish(),
});

export const uploadIdInput = z.object({ uploadId: z.uuid() });

export const chunkMetaInput = z.object({
  uploadId: z.uuid(),
  index: z.number().int().nonnegative(),
});

/** 二进制面 `POST /api/upload/chunk` 的 query（`A3` §7）：参数来自 URL，故均为字符串 */
export const uploadChunkQuery = z.object({
  uploadId: z.uuid(),
  index: queryIntSchema,
});

export const uploadPartMetaSchema = z.object({
  partNumber: z.number(),
  etag: z.string().optional(),
  size: z.number().optional(),
});

export const uploadSessionSchema = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  parentId: z.uuid().nullable(),
  userId: z.string(),
  fingerprint: z.string(),
  originalName: z.string(),
  relativePath: z.string().nullable(),
  mime: z.string().nullable(),
  size: z.number(),
  chunkSize: z.number(),
  totalChunks: z.number(),
  uploadedParts: z.array(z.number()),
  partsMeta: z.array(uploadPartMetaSchema),
  providerUploadId: z.string().nullable(),
  storageKey: z.string(),
  sha256: z.string().nullable(),
  status: z.enum(uploadStatusEnum.enumValues),
  error: z.string().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const uploadSessionArraySchema = z.array(uploadSessionSchema);

/** `init` 判别联合：秒传命中 vs 需继续分片上传 */
export const uploadInitSchema = z.discriminatedUnion("instant", [
  z.object({ instant: z.literal(true), fileNode: fileNodeSchema }),
  z.object({
    instant: z.literal(false),
    uploadId: z.uuid(),
    chunkSize: z.number(),
    totalChunks: z.number(),
    uploadedParts: z.array(z.number()),
    providerUploadId: z.string().nullable(),
    storageKey: z.string(),
  }),
]);

export const uploadCompleteSchema = z.object({ fileNode: fileNodeSchema });

export const chunkMetaSchema = z.object({ received: z.boolean() });

export const cleanupSchema = z.object({ cleaned: z.number() });
