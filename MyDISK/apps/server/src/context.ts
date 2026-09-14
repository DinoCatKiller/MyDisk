import type { Context as ApiContext } from "@MyDISK/api/context";
import type { Context as HonoContext } from "hono";

import { adminAuth, auth, getDb } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

function getClientIp(context: HonoContext): string | null {
  const forwarded = context.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return context.req.header("x-real-ip") ?? null;
}

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const headers = context.req.raw.headers;
  const session = await auth.api.getSession({ headers });

  return {
    db: getDb(),
    auth,
    adminAuth,
    session,
    headers,
    /** 过程内写入的响应头（Set-Cookie），由 index.ts 合并到最终响应 */
    responseHeaders: new Headers(),
    requestInfo: {
      ip: getClientIp(context),
      userAgent: context.req.header("user-agent") ?? null,
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
