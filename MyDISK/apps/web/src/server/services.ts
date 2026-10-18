import { createAuth as createConfiguredAuth } from "@MyDISK/auth";
import { type Database, createDb } from "@MyDISK/db";

import { env } from "./env.server";

const database = createDb(env);

export function getDb(): Database {
  return database;
}

/** 运行时认证实例：不存在注册能力 */
export const auth = createConfiguredAuth(env, database);

/** 仅服务端内部使用：允许建号，供创始人新增管理员 */
export const adminAuth = createConfiguredAuth(env, database, { allowSignUp: true });
