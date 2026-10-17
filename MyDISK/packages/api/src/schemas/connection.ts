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
