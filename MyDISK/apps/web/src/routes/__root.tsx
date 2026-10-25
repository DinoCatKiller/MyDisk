import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
} from "@tanstack/solid-router";
import type { JSX } from "@solidjs/web";

import type { RouterContext } from "~/lib/session";
import { fetchSession } from "~/server/fns";

import "../styles.css";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [{ title: "MyDisk · 私人云盘" }],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  }),
  /**
   * 服务端解析会话并注入路由 context（`D8`）：SSR 期间直接拿到真实会话，
   * 首屏即可渲染受保护内容；未登录则直接重定向，避免前端"先渲染再跳转"。
   */
  beforeLoad: async ({ location }) => {
    const session = await fetchSession();
    const onLogin = location.pathname === "/login";

    if (!session && !onLogin) {
      throw redirect({ to: "/login", replace: true });
    }
    if (session && onLogin) {
      throw redirect({ to: "/files", replace: true });
    }

    return { session };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootShell(props: { children: JSX.Element }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <HeadContent />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}

function NotFound() {
  return (
    <main class="container mx-auto max-w-3xl px-4 py-10">
      <h1 class="text-3xl font-bold">页面不存在</h1>
    </main>
  );
}
