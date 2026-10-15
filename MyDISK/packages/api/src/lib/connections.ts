import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import type { Database } from "@MyDISK/db";
import { storageConnection, type StorageConnectionRow } from "@MyDISK/db/schema";
import { createStorageDriver, type StorageDriver } from "@MyDISK/storage";

/** 连接对外的安全视图：绝不携带密钥原文 */
export type PublicConnection = {
  id: string;
  name: string;
  type: StorageConnectionRow["type"];
  isDefault: boolean;
  status: StorageConnectionRow["status"];
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  rootPrefix: string;
  configMasked: Record<string, string>;
  totalSize: number;
  fileCount: number;
  syncStatus: StorageConnectionRow["syncStatus"];
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toPublicConnection(row: StorageConnectionRow): PublicConnection {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    isDefault: row.isDefault,
    status: row.status,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    rootPrefix: row.rootPrefix,
    configMasked: row.configMasked,
    totalSize: row.totalSize,
    fileCount: row.fileCount,
    syncStatus: row.syncStatus,
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 指定连接，未指定时取全局默认连接 */
export async function resolveConnection(
  db: Database,
  connectionId?: string | null,
): Promise<StorageConnectionRow> {
  const rows = connectionId
    ? await db
        .select()
        .from(storageConnection)
        .where(eq(storageConnection.id, connectionId))
        .limit(1)
    : await db
        .select()
        .from(storageConnection)
        .where(eq(storageConnection.isDefault, true))
        .limit(1);

  const connection = rows[0];
  if (!connection) {
    throw new ORPCError("NOT_FOUND", {
      message: connectionId ? "存储连接不存在" : "尚未配置默认存储连接，请先在设置中新增连接",
    });
  }
  if (connection.status !== "active") {
    throw new ORPCError("STORAGE_UNREACHABLE", {
      message: `存储连接「${connection.name}」当前不可用`,
    });
  }
  return connection;
}

/**
 * 为连接创建驱动。
 * 云连接的 config_enc 解密在 P3 接入驱动时补齐（当前仅 local）。
 */
export function driverFor(connection: StorageConnectionRow, storageRoot: string): StorageDriver {
  return createStorageDriver(
    {
      id: connection.id,
      type: connection.type,
      bucket: connection.bucket,
      region: connection.region,
      endpoint: connection.endpoint,
      rootPrefix: connection.rootPrefix,
      config: null,
    },
    { localRoot: storageRoot },
  );
}
