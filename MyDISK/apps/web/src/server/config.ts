import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_CHUNK_SIZE } from "@MyDISK/api/lib/files";

import { env } from "./env.server";

/**
 * 项目根目录：apps/web/src/server → 上溯四级（构建后为 dist/server，深度相同）。
 * 用 `import.meta.url` 而非 Bun 专有的 `import.meta.dir`：`vite dev` 的 SSR 由 node 承载，
 * 后者在 node 下是 undefined，会让本模块在 dev 模式整体抛错。
 */
const projectRoot = fileURLToPath(new URL("../../../..", import.meta.url));

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
  redisUrl: env.REDIS_URL || "redis://127.0.0.1:6379",
  /** 本地存储根：默认 <项目根>/storage */
  storageRoot: resolveStorageRoot(env.STORAGE_ROOT),
  uploadChunkSize: env.UPLOAD_CHUNK_SIZE || DEFAULT_CHUNK_SIZE,
  encryptionKey: env.ENCRYPTION_KEY,
  apiReferenceEnabled: env.API_REFERENCE_ENABLED,
  webdavEnabled: env.WEBDAV_ENABLED,
} as const;
