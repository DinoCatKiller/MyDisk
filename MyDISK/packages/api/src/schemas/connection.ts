import * as z from "zod";

import { connectionStatusEnum, connectionSyncStatusEnum, storageTypeEnum } from "@MyDISK/db/schema";

/**
 * 存储连接对外的安全视图（allow-list）：显式列举字段，绝不携带 `config_enc` 密钥。
 * 新增敏感列不会自动进入本 schema（与黑名单式 `.omit` 相反，见 `A4`）。
 */
export const publicConnectionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(storageTypeEnum.enumValues),
  isDefault: z.boolean(),
  status: z.enum(connectionStatusEnum.enumValues),
  bucket: z.string().nullable(),
  region: z.string().nullable(),
  endpoint: z.string().nullable(),
  rootPrefix: z.string(),
  configMasked: z.record(z.string(), z.string()),
  totalSize: z.number(),
  fileCount: z.number(),
  syncStatus: z.enum(connectionSyncStatusEnum.enumValues),
  lastSyncAt: z.date().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PublicConnection = z.infer<typeof publicConnectionSchema>;

export const connectionIdInput = z.object({ id: z.uuid() });

const connectionName = z
  .string()
  .trim()
  .min(1, "连接名称不能为空")
  .max(64, "连接名称最多 64 个字符");
const rootPrefix = z.string().trim().max(256, "根前缀最多 256 个字符").default("");

/** 密钥字段与 `@MyDISK/storage` 的 `createStorageDriver` 逐一对齐（`A4` §4） */
export const connectionSecretConfigSchema = {
  cos: z.object({
    secretId: z.string().min(1, "SecretId 不能为空"),
    secretKey: z.string().min(1, "SecretKey 不能为空"),
  }),
  oss: z.object({
    accessKeyId: z.string().min(1, "AccessKeyId 不能为空"),
    accessKeySecret: z.string().min(1, "AccessKeySecret 不能为空"),
  }),
  s3: z.object({
    accessKeyId: z.string().min(1, "AccessKeyId 不能为空"),
    secretAccessKey: z.string().min(1, "SecretAccessKey 不能为空"),
  }),
} as const;

export const connectionCreateInput = z.discriminatedUnion("type", [
  z.object({
    name: connectionName,
    type: z.literal("local"),
    rootPrefix,
  }),
  z.object({
    name: connectionName,
    type: z.literal("cos"),
    bucket: z.string().trim().min(1, "bucket 不能为空"),
    region: z.string().trim().min(1, "region 不能为空"),
    endpoint: z.string().trim().optional(),
    rootPrefix,
    config: connectionSecretConfigSchema.cos,
  }),
  z.object({
    name: connectionName,
    type: z.literal("oss"),
    bucket: z.string().trim().min(1, "bucket 不能为空"),
    region: z.string().trim().min(1, "region 不能为空"),
    endpoint: z.string().trim().optional(),
    rootPrefix,
    config: connectionSecretConfigSchema.oss,
  }),
  z.object({
    name: connectionName,
    type: z.literal("s3"),
    bucket: z.string().trim().min(1, "bucket 不能为空"),
    region: z.string().trim().optional(),
    endpoint: z.string().trim().optional(),
    rootPrefix,
    config: connectionSecretConfigSchema.s3,
  }),
]);

export type ConnectionCreateInput = z.infer<typeof connectionCreateInput>;

/** `type` 不可改：编辑时只允许这些可变字段 */
export const connectionUpdateInput = z.object({
  id: z.uuid(),
  name: connectionName.optional(),
  bucket: z.string().trim().optional(),
  region: z.string().trim().optional(),
  endpoint: z.string().trim().optional(),
  rootPrefix: z.string().trim().max(256).optional(),
  /** 不传 = 保持原密钥；传入才重新校验、加密、掩码 */
  config: z.record(z.string(), z.unknown()).optional(),
});

export const connectionTestInput = z.union([
  connectionIdInput,
  z.object({ draft: connectionCreateInput }),
]);

export const connectionTestOutput = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  error: z.string().optional(),
});

export const connectionSetDefaultInput = z.object({
  id: z.uuid(),
  sync: z.enum(["now", "later", "skip"]).default("skip"),
});

export const connectionSetDefaultOutput = z.object({ switched: z.boolean() });

export const connectionUsageOutput = z.object({ totalSize: z.number(), fileCount: z.number() });
