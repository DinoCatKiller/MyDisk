import type { Auth } from "@MyDISK/auth";
import type { Database } from "@MyDISK/db";

/**
 * 请求上下文。
 * - auth：运行时认证实例（禁止注册）
 * - adminAuth：仅服务端内部使用，允许创建账户（新增管理员）
 * - responseHeaders：过程内收集的响应头（主要是 Set-Cookie），由 server 层写入最终响应
 */
export type Context = {
  db: Database;
  auth: Auth;
  adminAuth: Auth;
  session: Awaited<ReturnType<Auth["api"]["getSession"]>>;
  headers: Headers;
  responseHeaders: Headers;
  /** 本地存储根目录（绝对路径），由 server 注入，供创建本地驱动使用 */
  storageRoot: string;
  /** 二进制面短时令牌签名密钥，由 server 注入 */
  signingSecret: string;
  requestInfo: {
    ip: string | null;
    userAgent: string | null;
  };
};
