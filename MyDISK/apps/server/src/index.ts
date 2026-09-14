import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { appRouter } from "@MyDISK/api/routers/index";

import { serverConfig } from "./config";
import { createContext } from "./context";
import { env } from "./env.server";
import { generateOpenApiDocument } from "./openapi";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    exposeHeaders: ["Content-Disposition", "Content-Length", "Content-Range"],
  }),
);

/**
 * 注意：/api/auth/* 不再对外暴露。
 * 认证全部通过 oRPC（authRouter）通讯，Better-Auth 实例仅在服务端内部调用。
 */

export const apiHandler = new OpenAPIHandler(appRouter, {
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

export const rpcHandler = new RPCHandler(appRouter, {
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

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context,
  });

  if (rpcResult.matched) {
    const response = c.newResponse(rpcResult.response.body, rpcResult.response);
    mergeResponseHeaders(response, context.responseHeaders);
    return response;
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context,
  });

  if (apiResult.matched) {
    const response = c.newResponse(apiResult.response.body, apiResult.response);
    mergeResponseHeaders(response, context.responseHeaders);
    return response;
  }

  await next();
});

/** OpenAPI 3.1 文档 */
app.get("/openapi.json", async (c) => {
  if (!serverConfig.apiReferenceEnabled) {
    return c.notFound();
  }
  const document = await generateOpenApiDocument(env.BETTER_AUTH_URL);
  return c.json(document);
});

app.get("/", (c) => {
  return c.text("MyDisk API is running. See /api-reference for OpenAPI docs.");
});

export default app;
