import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type CliEnv = {
  projectRoot: string;
  NODE_ENV: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGIN: string;
  STORAGE_ROOT: string;
  ENCRYPTION_KEY: string;
  UPLOAD_CHUNK_SIZE: number;
};

/** packages/cli/src/lib → 上溯四级到项目根 */
export function getProjectRoot(): string {
  return resolve(import.meta.dir, "../../../..");
}

export const SERVER_ENV_PATH = "apps/server/.env";
export const INSTALL_MARK = "node_modules/.pstorage-installed";

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** 读取 apps/server/.env，并允许真实环境变量覆盖 */
export function loadCliEnv(): CliEnv {
  const projectRoot = getProjectRoot();
  const fileVars = parseEnvFile(resolve(projectRoot, SERVER_ENV_PATH));
  const pick = (key: string, fallback: string): string =>
    process.env[key] || fileVars[key] || fallback;

  return {
    projectRoot,
    NODE_ENV: pick("NODE_ENV", "development"),
    DATABASE_URL: pick("DATABASE_URL", "postgres://postgres:123456@127.0.0.1:5432/pstorage"),
    REDIS_URL: pick("REDIS_URL", "redis://127.0.0.1:6379"),
    BETTER_AUTH_SECRET: pick("BETTER_AUTH_SECRET", "my-disk-development-secret-key-0001"),
    BETTER_AUTH_URL: pick("BETTER_AUTH_URL", "http://localhost:3000"),
    CORS_ORIGIN: pick("CORS_ORIGIN", "http://localhost:3001"),
    STORAGE_ROOT: pick("STORAGE_ROOT", ""),
    ENCRYPTION_KEY: pick("ENCRYPTION_KEY", "my-disk-dev-only-encryption-key-01"),
    UPLOAD_CHUNK_SIZE: Number(pick("UPLOAD_CHUNK_SIZE", "8388608")),
  };
}

/** 数据库连接串脱敏，便于打印 */
export function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
