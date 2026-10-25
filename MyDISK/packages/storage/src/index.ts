import { CosDriver } from "./drivers/cos";
import { LocalStorageDriver } from "./drivers/local";
import { OssDriver } from "./drivers/oss";
import { S3Driver } from "./drivers/s3";
import { StorageError } from "./errors";
import type { StorageConnectionLike, StorageDriver } from "./types";

export * from "./crypto";
export * from "./errors";
export * from "./key";
export * from "./types";
export { CosDriver, LocalStorageDriver, OssDriver, S3Driver };

export const DEFAULT_LOCAL_ROOT = "storage";

/** 云连接 config_enc 解密后的密钥字段（按类型，见 `A4` §4） */
export type CloudSecret =
  | { secretId: string; secretKey: string }
  | { accessKeyId: string; accessKeySecret: string }
  | { accessKeyId: string; secretAccessKey: string };

/**
 * 根据连接配置创建存储驱动（`A4`）。
 *
 * 云驱动的密钥从 `connection.config`（已由调用方解密 `config_enc` 得到）里按
 * 类型约定取用：cos → secretId/secretKey；oss → accessKeyId/accessKeySecret；
 * s3 → accessKeyId/secretAccessKey。
 */
export function createStorageDriver(
  connection: StorageConnectionLike,
  options: { localRoot?: string } = {},
): StorageDriver {
  const config = connection.config ?? {};
  switch (connection.type) {
    case "local": {
      const root =
        (typeof config.root === "string" && config.root) || options.localRoot || DEFAULT_LOCAL_ROOT;
      return new LocalStorageDriver({
        root,
        connectionId: connection.id,
        rootPrefix: connection.rootPrefix,
      });
    }
    case "cos":
      return new CosDriver({
        bucket: connection.bucket ?? "",
        region: connection.region,
        secretId: String(config.secretId ?? ""),
        secretKey: String(config.secretKey ?? ""),
        rootPrefix: connection.rootPrefix,
      });
    case "oss":
      return new OssDriver({
        bucket: connection.bucket ?? "",
        region: connection.region,
        endpoint: connection.endpoint,
        accessKeyId: String(config.accessKeyId ?? ""),
        accessKeySecret: String(config.accessKeySecret ?? ""),
        rootPrefix: connection.rootPrefix,
      });
    case "s3":
      return new S3Driver({
        bucket: connection.bucket ?? "",
        region: connection.region,
        endpoint: connection.endpoint,
        accessKeyId: String(config.accessKeyId ?? ""),
        secretAccessKey: String(config.secretAccessKey ?? ""),
        rootPrefix: connection.rootPrefix,
      });
    default: {
      const exhaustive: never = connection.type;
      throw new StorageError("UNKNOWN", `未知存储类型: ${String(exhaustive)}`);
    }
  }
}
