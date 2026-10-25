import { createStorageDriver, decryptSecret, type StorageDriver } from "@MyDISK/storage";
import type { StorageConnectionRow } from "@MyDISK/db/schema";

/**
 * 连接行 → 存储驱动（与 `@MyDISK/api` 的 `driverFor` 同语义）。
 *
 * worker 依赖方向只到 db / storage（`A1` §2.2），故在此自持一份：
 * 云连接把 `config_enc` 用 AES-256-GCM 解密后交给驱动（`A4` §4）。
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
      throw new Error("缺少 ENCRYPTION_KEY，无法解密云存储连接的密钥");
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
