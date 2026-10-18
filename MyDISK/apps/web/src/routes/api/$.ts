import { createFileRoute } from "@tanstack/solid-router";
import type { Hono } from "hono";

import { createApiApp } from "~/server/app";

let apiApp: Hono | undefined;

/**
 * Hono API 子系统入口（`D8` / `GUI` §4）。
 *
 * 仅声明 `server`，因此该节点会被 Start 从客户端路由树中剪除（server-only route）。
 * Hono 内部路径自带 `/api` 前缀，故这里直接把原始请求交给它处理——不改写 path。
 */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: ({ request }) => {
        apiApp ??= createApiApp();
        return apiApp.fetch(request);
      },
    },
  },
});
