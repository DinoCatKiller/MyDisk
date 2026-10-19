import type { AppRouterClient } from "@MyDISK/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

/**
 * oRPC 客户端（`D3` 控制面）。
 *
 * 单 app 同源（`D8`）：前端与 Hono `api` 子系统同进程同端口，
 * 因此链路固定指向本机相对路径 `/api/rpc`，不再需要拼服务器地址。
 */
const link = new RPCLink({
  url: "/api/rpc",
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);
