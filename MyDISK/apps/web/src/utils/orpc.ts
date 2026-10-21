import type { AppRouterClient } from "@MyDISK/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

/**
 * oRPC 客户端（`D3` 控制面）。
 *
 * 单 app 同源（`D8`）：前端与 Hono `api` 子系统同进程同端口，
 * 链路固定指向本机 `/api/rpc`，不拼任何配置的服务器地址。
 *
 * `url` 写成**惰性函数**（oRPC 的 `Value` 类型支持）：
 * - 模块在 SSR 也会被求值，直接读 `window` 会抛 `window is not defined`；
 * - URL 在请求发生时才用 `window.location.origin` 计算，dev 端口、生产域名、
 *   反向代理都自动跟随，不存在写死主机的问题；
 * - 但必须是**绝对 URL**：oRPC 的 `StandardRPCLinkCodec.encode` 内部直接
 *   `new URL(baseUrl)`，相对路径会抛 `Invalid URL`，请求根本发不出去。
 */
const link = new RPCLink({
  url: () => new URL("/api/rpc", window.location.origin),
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);
