import type { Database } from "@MyDISK/db";
import * as schema from "@MyDISK/db/schema/auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export type AuthConfig = {
  NODE_ENV?: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export type CreateAuthOptions = {
  /**
   * 仅安装流程使用：临时允许 signUpEmail 以创建首个创始人管理员。
   * 系统运行时必须保持 false —— 本系统不提供公开注册。
   */
  allowSignUp?: boolean;
  /** 桌面端 / 移动端附加的可信来源 */
  desktopOrigins?: readonly string[];
};

export function createAuth(env: AuthConfig, database: Database, options: CreateAuthOptions = {}) {
  const isProduction = env.NODE_ENV === "production";

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...(options.desktopOrigins ?? [])],
    emailAndPassword: {
      enabled: true,
      // 系统不存在公开注册能力
      disableSignUp: !(options.allowSignUp ?? false),
      minPasswordLength: 8,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "admin",
          input: false,
        },
        status: {
          type: "string",
          required: false,
          defaultValue: "active",
          input: false,
        },
        mustChangePassword: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
        lastLoginAt: {
          type: "date",
          required: false,
          input: false,
        },
        lastLoginIp: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    advanced: {
      defaultCookieAttributes: isProduction
        ? { sameSite: "none", secure: true, httpOnly: true }
        : { sameSite: "lax", secure: false, httpOnly: true },
    },
    plugins: [],
  });
}

export type Auth = ReturnType<typeof createAuth>;
