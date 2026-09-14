import { isAbsolute, resolve } from "node:path";

import { env } from "./env.server";

/** 项目根目录：apps/server/src → 上溯三级 */
const projectRoot = resolve(import.meta.dir, "../../..");

/** 相对路径基于项目根解析，避免受运行时 cwd 影响 */
function resolveStorageRoot(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return resolve(projectRoot, "storage");
  }
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

export const serverConfig = {
  projectRoot,
  port: Number(process.env.PORT ?? 3000),
  redisUrl: env.REDIS_URL || "redis://127.0.0.1:6379",
  /** 本地存储根：默认 <项目根>/storage */
  storageRoot: resolveStorageRoot(env.STORAGE_ROOT),
  uploadChunkSize: env.UPLOAD_CHUNK_SIZE || 8 * 1024 * 1024,
  encryptionKey: env.ENCRYPTION_KEY,
  apiReferenceEnabled: env.API_REFERENCE_ENABLED,
  webdavEnabled: env.WEBDAV_ENABLED,
} as const;
