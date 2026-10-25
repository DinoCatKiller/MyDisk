import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type WorkerEnv = {
  NODE_ENV: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  STORAGE_ROOT: string;
  ENCRYPTION_KEY: string;
  /** 回收站保留天数（system_setting 缺省时用） */
  TRASH_RETENTION_DAYS: number;
  /** 暂存分片超过该小时数未活动即 GC */
  TMP_PART_MAX_AGE_HOURS: number;
};

/** apps/worker/src → 项目根（MyDISK/）上溯三级 */
export function getProjectRoot(): string {
  return resolve(import.meta.dir, "../../..");
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    result[key] = value;
  }
  return result;
}

/**
 * worker 的环境变量：与 web 单 app 共用 `apps/web/.env`（单一事实来源），
 * process.env 显式设置的值优先（便于容器 / 服务化部署覆盖）。
 */
export function loadWorkerEnv(): WorkerEnv {
  const file = parseEnvFile(resolve(getProjectRoot(), "apps/web/.env"));
  const read = (key: string, fallback = ""): string => process.env[key] ?? file[key] ?? fallback;
  return {
    NODE_ENV: read("NODE_ENV", "development"),
    DATABASE_URL: read("DATABASE_URL", "postgres://postgres:123456@127.0.0.1:5432/pstorage"),
    REDIS_URL: read("REDIS_URL", "redis://127.0.0.1:6379"),
    STORAGE_ROOT: read("STORAGE_ROOT", "storage"),
    ENCRYPTION_KEY: read("ENCRYPTION_KEY"),
    TRASH_RETENTION_DAYS: Number(read("TRASH_RETENTION_DAYS", "30")),
    TMP_PART_MAX_AGE_HOURS: Number(read("TMP_PART_MAX_AGE_HOURS", "24")),
  };
}
