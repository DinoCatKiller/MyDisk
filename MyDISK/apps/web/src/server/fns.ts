import { call } from "@orpc/server";
import { getRequestEvent } from "@solidjs/web";
import { createServerFn } from "@tanstack/solid-start";

import { appRouter } from "@MyDISK/api";
import { listFilesInput, nodeIdInput } from "@MyDISK/api/schemas/file";
import type { FileNode } from "@MyDISK/api/schemas/file";

import type { SessionUser } from "~/lib/session";

import { createContextFromHeaders } from "./context";

/**
 * 取当前请求的原始请求头。
 *
 * SSR 时 Start 在进程内直调 server function（`ssr-rpc`），
 * 客户端导航时走 serverFn 的 HTTP 端点，两条路径都在请求作用域内。
 */
function currentHeaders(): Headers {
  const event = getRequestEvent();
  if (!event) {
    throw new Error("缺少请求上下文：服务端取数函数必须在请求作用域内调用");
  }
  return event.request.headers;
}

/** 服务端解析当前会话（`D8` SSR 数据装载的会话来源） */
export const fetchSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    const context = await createContextFromHeaders(currentHeaders());
    const user = context.session?.user;
    return user ? (user as unknown as SessionUser) : null;
  },
);

/** 列出目录内容（`file.list`） */
export const fetchFileList = createServerFn({ method: "GET" })
  .validator(listFilesInput)
  .handler(async ({ data }) => {
    const context = await createContextFromHeaders(currentHeaders());
    return await call(appRouter.file.list, data, { context });
  });

/** 面包屑祖先链（`file.path`） */
export const fetchFilePath = createServerFn({ method: "GET" })
  .validator(nodeIdInput)
  .handler(async ({ data }): Promise<FileNode[]> => {
    const context = await createContextFromHeaders(currentHeaders());
    return await call(appRouter.file.path, data, { context });
  });

/** 管理员列表（`auth.listAdmins`，权限由过程内部校验） */
export const fetchAdmins = createServerFn({ method: "GET" }).handler(async () => {
  const context = await createContextFromHeaders(currentHeaders());
  return await call(appRouter.auth.listAdmins, undefined, { context });
});
