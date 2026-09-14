import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

type SessionUser = {
  id: string;
  role?: string | null;
  status?: string | null;
};

function getUser(session: Context["session"]): SessionUser | null {
  const user = session?.user as SessionUser | undefined;
  return user ?? null;
}

/** 需登录，且账户未被禁用 */
const requireAuth = o.middleware(async ({ context, next }) => {
  const user = getUser(context.session);
  if (!user || !context.session) {
    throw new ORPCError("UNAUTHORIZED");
  }
  if (user.status === "disabled") {
    throw new ORPCError("FORBIDDEN", { message: "账户已被禁用" });
  }
  return next({
    context: {
      session: context.session,
      user,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/** 仅创始人管理员 */
const requireFounder = o.middleware(async ({ context, next }) => {
  const user = getUser(context.session);
  if (!user || !context.session) {
    throw new ORPCError("UNAUTHORIZED");
  }
  if (user.role !== "founder") {
    throw new ORPCError("FORBIDDEN", { message: "仅创始人管理员可执行该操作" });
  }
  return next({
    context: {
      session: context.session,
      user,
    },
  });
});

export const founderProcedure = publicProcedure.use(requireFounder);
