import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { sessionPending, sessionUser, useRequireAuth } from "~/lib/session";

import { AppShell, SessionLoading } from "./app-shell";

export type ProtectedProps = {
  title: string;
  description?: string;
  actions?: JSX.Element;
  children: JSX.Element;
};

/** 受保护页面外壳：未登录自动跳转，登录后套用控制台布局 */
export function Protected(props: ProtectedProps) {
  useRequireAuth();

  return (
    <Show when={!sessionPending() && sessionUser()} fallback={<SessionLoading />}>
      <AppShell title={props.title} description={props.description} actions={props.actions}>
        {props.children}
      </AppShell>
    </Show>
  );
}
