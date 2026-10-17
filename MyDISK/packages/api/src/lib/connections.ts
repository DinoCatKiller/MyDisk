import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import type { Database } from "@MyDISK/db";
import { storageConnection, type StorageConnectionRow } from "@MyDISK/db/schema";
import { createStorageDriver, type StorageDriver } from "@MyDISK/storage";

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
