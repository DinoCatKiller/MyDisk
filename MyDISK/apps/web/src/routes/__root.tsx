import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/solid-router";
import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";

import { ensureSession } from "~/lib/session";

import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ title: "MyDisk · 私人云盘" }],
  }),
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
  // 仅客户端加载会话，避免 SSR 期间跨请求共享状态
  onSettled(() => {
    void ensureSession();
  });

  return <Outlet />;
}

function NotFound() {
  return (
    <main class="container mx-auto max-w-3xl px-4 py-10">
      <h1 class="text-3xl font-bold">页面不存在</h1>
    </main>
  );
}
