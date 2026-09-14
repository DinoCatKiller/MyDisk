import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createAuth, type Auth } from "@MyDISK/auth";
import { type Database, createDb } from "@MyDISK/db";
import { eq, sql } from "drizzle-orm";

import { user } from "@MyDISK/db/schema/auth";
import { storageConnection } from "@MyDISK/db/schema/storage";
import { systemSetting } from "@MyDISK/db/schema/system";
import { encryptSecret } from "@MyDISK/storage";

import { type CliEnv, INSTALL_MARK } from "./env";

export function makeDb(env: CliEnv): Database {
  return createDb({ DATABASE_URL: env.DATABASE_URL });
}

export function makeAuth(env: CliEnv, db: Database, allowSignUp = false): Auth {
  return createAuth(
    {
      NODE_ENV: env.NODE_ENV,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      CORS_ORIGIN: env.CORS_ORIGIN,
    },
    db,
    { allowSignUp },
  );
}

/** 数据库连通性自检，失败时给出可操作的提示 */
export async function checkDatabase(env: CliEnv): Promise<void> {
  const db = makeDb(env);
  await db.execute(sql`select 1`);
}

/** 调用 drizzle-kit push 建表 */
export function pushSchema(env: CliEnv): { ok: boolean; output: string } {
  const cwd = join(env.projectRoot, "packages/db");
  const command = process.platform === "win32" ? "bunx.cmd" : "bunx";
  const result = spawnSync(command, ["drizzle-kit", "push", "--force"], {
    cwd,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

export async function findFounder(db: Database) {
  const rows = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.role, "founder"))
    .limit(1);
  return rows[0] ?? null;
}

export type FounderInput = {
  name: string;
  email: string;
  password: string;
};

/**
 * 创建创始人管理员。
 * 通过 allowSignUp 的认证实例建号，保证密码哈希与 Better-Auth 完全一致。
 */
export async function createFounder(
  env: CliEnv,
  db: Database,
  input: FounderInput,
): Promise<{ id: string; email: string; name: string }> {
  const existing = await findFounder(db);
  if (existing) {
    throw new Error(`已存在创始人管理员：${existing.email}`);
  }

  const auth = makeAuth(env, db, true);
  const created = await auth.api.signUpEmail({
    body: {
      name: input.name,
      email: input.email,
      password: input.password,
    },
  });

  const [row] = await db
    .update(user)
    .set({ role: "founder", status: "active", mustChangePassword: true })
    .where(eq(user.id, created.user.id))
    .returning({ id: user.id, email: user.email, name: user.name });

  if (!row) {
    throw new Error("创始人管理员创建失败");
  }
  return row;
}

/** 建立默认本地连接（本地连接全局唯一） */
export async function ensureLocalConnection(
  env: CliEnv,
  db: Database,
  ownerId: string,
): Promise<string> {
  const existing = await db
    .select({ id: storageConnection.id })
    .from(storageConnection)
    .where(eq(storageConnection.type, "local"))
    .limit(1);
  if (existing[0]) {
    return existing[0].id;
  }

  const root = env.STORAGE_ROOT || join(env.projectRoot, "storage");
  mkdirSync(root, { recursive: true });

  const [row] = await db
    .insert(storageConnection)
    .values({
      name: "local",
      type: "local",
      isDefault: true,
      status: "active",
      rootPrefix: "",
      configEnc: encryptSecret(JSON.stringify({ root }), env.ENCRYPTION_KEY),
      configMasked: { root },
      createdBy: ownerId,
    })
    .returning({ id: storageConnection.id });

  if (!row) {
    throw new Error("默认本地连接创建失败");
  }
  return row.id;
}

export async function writeInitialSettings(
  env: CliEnv,
  db: Database,
  connectionId: string,
): Promise<void> {
  const settings: Record<string, unknown> = {
    installed_at: new Date().toISOString(),
    version: "1.0.0",
    default_connection_id: connectionId,
    upload_chunk_size: env.UPLOAD_CHUNK_SIZE,
    trash_retention_days: 30,
    webdav_enabled: true,
    api_reference_enabled: true,
    site_name: "MyDisk",
  };

  for (const [key, value] of Object.entries(settings)) {
    await db
      .insert(systemSetting)
      .values({ key, value })
      .onConflictDoUpdate({
        target: systemSetting.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

export function isInstalled(env: CliEnv): boolean {
  return existsSync(join(env.projectRoot, INSTALL_MARK));
}

export function markInstalled(env: CliEnv): string {
  const markPath = join(env.projectRoot, INSTALL_MARK);
  mkdirSync(dirname(markPath), { recursive: true });
  writeFileSync(markPath, new Date().toISOString(), "utf8");
  return markPath;
}
