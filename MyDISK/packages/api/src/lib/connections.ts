import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import type { Database } from "@MyDISK/db";
import { storageConnection, type StorageConnectionRow } from "@MyDISK/db/schema";
import {
  createStorageDriver,
  decryptSecret,
  maskSecret,
  type StorageDriver,
  type StorageDriverType,
} from "@MyDISK/storage";

import { connectionSecretConfigSchema } from "../schemas/connection";

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
 * 展示用掩码配置：字符串值保留前 4 / 后 4 位；`root` 与 `forcePathStyle` 不是密钥，原样保留。
 * 本地连接不落密钥配置，恒返回空对象（`A4` §4）。
 */
export function maskConnectionConfig(
  type: StorageDriverType,
  config: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (type === "local" || !config) {
    return {};
  }
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null) {
      continue;
    }
    masked[key] =
      key === "root" || key === "forcePathStyle" ? String(value) : maskSecret(String(value));
  }
  return masked;
}

/**
 * 按连接类型校验密钥配置并返回「待加密的原文 + 待展示的掩码」。
 * 云连接缺字段在此处就报错，避免把空凭证写进库、失败延后到第一次真实请求。
 */
export function normalizeConnectionConfig(
  type: StorageDriverType,
  raw: unknown,
): { config: Record<string, unknown> | null; masked: Record<string, string> } {
  if (type === "local") {
    return { config: null, masked: {} };
  }
  const schema = connectionSecretConfigSchema[type];
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("；");
    throw new ORPCError("BAD_REQUEST", {
      message: `${type.toUpperCase()} 连接密钥配置不完整（${detail}）`,
    });
  }
  const config = result.data as Record<string, unknown>;
  return { config, masked: maskConnectionConfig(type, config) };
}

/**
 * 为连接创建驱动。
 *
 * 云连接（cos/oss/s3）把 `config_enc` 用 AES-256-GCM 解密后交给驱动（`A4` §4）；
 * `encryptionKey` 缺省回落 `process.env.ENCRYPTION_KEY`（worker / cli 侧即如此）。
 */
export function driverFor(
  connection: StorageConnectionRow,
  storageRoot: string,
  encryptionKey?: string,
): StorageDriver {
  let config: Record<string, unknown> | null = null;
  if (connection.type !== "local" && connection.configEnc) {
    const key = encryptionKey ?? process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "缺少 ENCRYPTION_KEY，无法解密云存储连接的密钥",
      });
    }
    config = JSON.parse(decryptSecret(connection.configEnc, key)) as Record<string, unknown>;
  }
  return createStorageDriver(
    {
      id: connection.id,
      type: connection.type,
      bucket: connection.bucket,
      region: connection.region,
      endpoint: connection.endpoint,
      rootPrefix: connection.rootPrefix,
      config,
    },
    { localRoot: storageRoot },
  );
}
