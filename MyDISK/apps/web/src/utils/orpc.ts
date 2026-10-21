import type { AppRouterClient } from "@MyDISK/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

/**
 * oRPC 客户端（`D3` 控制面）。
 *
 * 单 app 同源（`D8`）：前端与 Hono `api` 子系统同进程同端口，
 * 因此链路固定指向本机 `/api/rpc`，不再需要拼服务器地址。
 *
 * 注意：浏览器端必须传**绝对 URL**——oRPC 的 `StandardRPCLinkCodec.encode`
 * 内部直接 `new URL(baseUrl)`，相对路径会抛 `Failed to construct 'URL': Invalid URL`，
 * 表现为点击登录后请求根本没发出。SSR 不使用本链路（走 serverFn 进程内直调）。
 */
const link = new RPCLink({
  url:
    typeof window === "undefined"
      ? "http://localhost/api/rpc"
      : new URL("/api/rpc", window.location.origin).toString(),
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);
