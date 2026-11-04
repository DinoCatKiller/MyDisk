import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createAuth, type Auth } from "@MyDISK/auth";
import { type Database, createDb } from "@MyDISK/db";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

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

/** 迁移文件目录（packages/db 的 drizzle-kit out） */
export function migrationsFolder(env: CliEnv): string {
  return join(env.projectRoot, "packages/db/src/migrations");
}

/** 调用 drizzle-kit push（仅开发期直推表结构用） */
export function pushSchema(env: CliEnv): { ok: boolean; output: string } {
  const cwd = join(env.projectRoot, "packages/db");
  const result = spawnSync("bunx", ["drizzle-kit", "push", "--force"], {
    cwd,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

/** 进程内执行迁移（不依赖 bunx / drizzle-kit，跨平台一致） */
export async function runMigrations(env: CliEnv): Promise<void> {
  const db = makeDb(env);
  await migrate(db, { migrationsFolder: migrationsFolder(env) });
}

/** 判断库里是否已有 db:push 建出的旧表结构 */
export async function hasLegacySchema(env: CliEnv): Promise<boolean> {
  const db = makeDb(env);
  const result = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.file_node') is not null as exists`,
  );
  return result.rows[0]?.exists ?? false;
}

type JournalEntry = { idx: number; when: number; tag: string };

function readJournal(folder: string): JournalEntry[] {
  const journalPath = join(folder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`找不到迁移索引：${journalPath}`);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };
  return journal.entries;
}

/**
 * 给「已由 db:push 建过表」的老库补迁移基线。
 * 按 journal 逐条写入 hash（sha256(文件内容)）与 when，与 drizzle 迁移器口径一致；
 * 补完之后 `db:migrate` 只会执行新增迁移。
 */
export async function markBaselineApplied(env: CliEnv): Promise<string[]> {
  const db = makeDb(env);
  const folder = migrationsFolder(env);
  const entries = readJournal(folder);

  await db.execute(sql`create schema if not exists "drizzle"`);
  await db.execute(sql`
    create table if not exists "drizzle"."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);

  const applied = new Set(
    (
      await db.execute<{ hash: string }>(sql`select hash from "drizzle"."__drizzle_migrations"`)
    ).rows.map((row) => row.hash),
  );

  const inserted: string[] = [];
  for (const entry of entries) {
    const content = readFileSync(join(folder, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    if (applied.has(hash)) {
      continue;
    }
    await db.execute(
      sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values (${hash}, ${entry.when})`,
    );
    inserted.push(entry.tag);
  }
  return inserted;
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
