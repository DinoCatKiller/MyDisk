import { useRouteContext } from "@tanstack/solid-router";
import type { Accessor } from "solid-js";

import { client } from "~/utils/orpc";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  status?: string | null;
  mustChangePassword?: boolean | null;
  image?: string | null;
  lastLoginAt?: string | Date | null;
};

/**
 * 根路由 `beforeLoad` 注入的路由上下文（`D8`）。
 *
 * 关键点：`getRouter()` 由 Start **按请求调用**，路由 context 天然跟随请求实例，
 * 因此会话放在这里不会在 SSR 期间跨请求串号（旧实现的模块级 signal 会）。
 */
export type RouterContext = {
  session: SessionUser | null;
};

/** 当前会话；随 `beforeLoad` / `router.invalidate()` 响应式更新 */
export function useSession(): Accessor<SessionUser | null> {
  return useRouteContext({
    from: "__root__",
    select: (context) => context.session,
  });
}

/** 是否创始人管理员 */
export function useIsFounder(): Accessor<boolean> {
  const session = useSession();
  return () => session()?.role === "founder";
}

export async function signIn(input: {
  email: string;
  password: string;
  rememberMe?: boolean;
}): Promise<{ mustChangePassword: boolean }> {
  const result = await client.auth.signIn(input);
  return { mustChangePassword: Boolean(result?.mustChangePassword) };
}

export async function signOut(): Promise<void> {
  await client.auth.signOut();
}
