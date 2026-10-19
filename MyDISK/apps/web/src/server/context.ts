import type { Context as ApiContext } from "@MyDISK/api/context";
import type { Context as HonoContext } from "hono";

import { serverConfig } from "./config";
import { env } from "./env.server";
import { adminAuth, auth, getDb } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return headers.get("x-real-ip") ?? null;
}

/**
 * 由请求头构造 oRPC 上下文。
 *
 * Hono 原生路由与 SSR loader（`fns.ts`）共用：后者拿不到 Hono context，
 * 只能拿到原始 `Headers`。
 */
export async function createContextFromHeaders(headers: Headers): Promise<ApiContext> {
  const session = await auth.api.getSession({ headers });

  return {
    db: getDb(),
    auth,
    adminAuth,
    session,
    headers,
    /** 过程内写入的响应头（Set-Cookie），由 app.ts 合并到最终响应 */
    responseHeaders: new Headers(),
    storageRoot: serverConfig.storageRoot,
    signingSecret: env.BETTER_AUTH_SECRET,
    requestInfo: {
      ip: getClientIp(headers),
      userAgent: headers.get("user-agent") ?? null,
    },
  };
}

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  return createContextFromHeaders(context.req.raw.headers);
}

export type Context = Awaited<ReturnType<typeof createContext>>;
