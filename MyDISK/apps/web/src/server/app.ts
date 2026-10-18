import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { logger } from "hono/logger";

import { appRouter } from "@MyDISK/api/routers/index";

import { serverConfig } from "./config";
import { createContext } from "./context";
import { env } from "./env.server";
import { generateOpenApiDocument } from "./openapi";
import { rawRoute } from "./routes/raw";
import { uploadChunkRoute } from "./routes/upload-chunk";

/**
 * 组装 Hono API 子系统（原 `apps/server/src/index.ts`）。
 *
 * 由 `apps/web/src/routes/api/$.ts` 以 `apiApp.fetch(request)` 直接挂载（不改写 path），
 * 因此这里所有路径都自带 **`/api` 前缀**（`GUI` §4 / `D8`）。
 */
export function createApiApp(): Hono {
  const app = new Hono();

  app.use(logger());
  // 单 app 同源：CORS 中间件退役（`GUI` §5）

  /**
   * 二进制面（`D3`）：分片上传与取流走 Hono 原生路由，不经 oRPC。
   * 注册在 oRPC 中间件之前，命中后直接返回。
   */
  app.route("/", uploadChunkRoute);
  app.route("/", rawRoute);

  /**
   * 注意：/api/auth/* 不再对外暴露（`D4`）。
   * 认证全部通过 oRPC（authRouter）通讯，Better-Auth 实例仅在服务端内部调用。
   */
  const apiHandler = new OpenAPIHandler(appRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
      }),
    ],
    interceptors: [
      onError((error) => {
        console.error(error);
      }),
    ],
  });

  const rpcHandler = new RPCHandler(appRouter, {
    interceptors: [
      onError((error) => {
        console.error(error);
      }),
    ],
  });

  /** 把过程内收集的响应头（主要是 Set-Cookie）合并到最终响应 */
  function mergeResponseHeaders(response: Response, extra: Headers): void {
    extra.forEach((value, key) => {
      response.headers.append(key, value);
    });
  }

  app.use("/api/*", async (c, next) => {
    const context = await createContext({ context: c });

    const rpcResult = await rpcHandler.handle(c.req.raw, {
      prefix: "/api/rpc",
      context,
    });

    if (rpcResult.matched) {
      const response = c.newResponse(rpcResult.response.body, rpcResult.response);
      mergeResponseHeaders(response, context.responseHeaders);
      return response;
    }

    // REST 面（OpenAPI 3.1，`D5`）与原 `/api-reference` 同前缀，整体迁入 `/api` 后为 `/api/reference/*`
    const apiResult = await apiHandler.handle(c.req.raw, {
      prefix: "/api/reference",
      context,
    });

    if (apiResult.matched) {
      const response = c.newResponse(apiResult.response.body, apiResult.response);
      mergeResponseHeaders(response, context.responseHeaders);
      return response;
    }

    await next();
  });

  /** OpenAPI 3.1 文档（外部 `/api/openapi.json`） */
  app.get("/api/openapi.json", async (c) => {
    if (!serverConfig.apiReferenceEnabled) {
      return c.notFound();
    }
    const document = await generateOpenApiDocument(env.BETTER_AUTH_URL);
    return c.json(document);
  });

  return app;
}
