import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { useSession } from "~/lib/session";

import { AppShell, SessionLoading } from "./app-shell";

export type ProtectedProps = {
  title: string;
  description?: string;
  actions?: JSX.Element;
  children: JSX.Element;
};

/**
 * 受保护页面外壳。
 *
 * 会话由根路由 `beforeLoad` 在进入本页面前解析完成（未登录会在那里直接重定向），
 * 因此这里不再需要"先渲染 loading、再去客户端拉会话"的旧逻辑。
 */
export function Protected(props: ProtectedProps) {
  const session = useSession();

  return (
    <Show when={session()} fallback={<SessionLoading />}>
      <AppShell title={props.title} description={props.description} actions={props.actions}>
        {props.children}
      </AppShell>
    </Show>
  );
}
