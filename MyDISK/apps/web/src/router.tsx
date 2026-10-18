import { createRouter } from "@tanstack/solid-router";

import { routeTree } from "./routeTree.gen";

/**
 * TanStack Start 路由入口（`D8`）。
 *
 * Start 通过 `#tanstack-router-entry` 读取本模块的 `getRouter()`；
 * `routeTree` 由 `@tanstack/solid-start` 的 file-based 插件生成（勿手改）。
 */
export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
  });
}
