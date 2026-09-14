import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { appRouter } from "@MyDISK/api/routers/index";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

/**
 * 生成 OpenAPI 3.1 文档。
 * 说明：oRPC 过程由 `.route()` 声明 REST 语义，可被完整推导；
 * 二进制路由（/api/upload/*、/api/raw/*、/dav/*）不经过 oRPC，
 * 将在 P2/P4 通过手写 spec 片段合并进来。
 */
export async function generateOpenApiDocument(serverUrl: string) {
  return generator.generate(appRouter, {
    info: {
      title: "MyDisk API",
      version: "1.0.0",
      description:
        "私人云盘系统接口。控制面通过 oRPC REST 语义暴露，文件二进制流走 /api/upload 与 /api/raw。",
    },
    servers: [{ url: serverUrl }],
  });
}
