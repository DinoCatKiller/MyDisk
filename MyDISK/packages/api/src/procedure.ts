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

/**
 * 仅创始人管理员。
 *
 * 叠加在 `protectedProcedure` 之上，因此「登录 + 未禁用」已由其保证，
 * 本中间件只判角色（`D4` 单管理员体系）。
 */
const requireFounder = o.middleware(async ({ context, next }) => {
  const user = getUser(context.session);
  // `protectedProcedure` 已保证会话存在；此处的判断只为收窄类型与兜底
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

export const founderProcedure = protectedProcedure.use(requireFounder);
