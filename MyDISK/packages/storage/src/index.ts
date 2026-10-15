import { LocalStorageDriver } from "./drivers/local";
import { StorageError } from "./errors";
import type { StorageConnectionLike, StorageDriver } from "./types";

export * from "./crypto";
export * from "./errors";
export * from "./key";
export * from "./types";
export { LocalStorageDriver };

export const DEFAULT_LOCAL_ROOT = "storage";

/**
 * 根据连接配置创建存储驱动。
 * P0/P1 仅实现本地驱动；COS / OSS / S3 在 P3 阶段接入。
 */
export function createStorageDriver(
  connection: StorageConnectionLike,
  options: { localRoot?: string } = {},
): StorageDriver {
  switch (connection.type) {
    case "local": {
      const config = connection.config ?? {};
      const root =
        (typeof config.root === "string" && config.root) || options.localRoot || DEFAULT_LOCAL_ROOT;
      return new LocalStorageDriver({
        root,
        connectionId: connection.id,
        rootPrefix: connection.rootPrefix,
      });
    }
    case "cos":
    case "oss":
    case "s3":
      throw new StorageError("NOT_IMPLEMENTED", `${connection.type} 驱动将在 P3 阶段实现`);
    default: {
      const exhaustive: never = connection.type;
      throw new StorageError("UNKNOWN", `未知存储类型: ${String(exhaustive)}`);
    }
  }
}
