import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { appRouter } from "@MyDISK/api";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

/** 统一错误响应体（`A3` §11.5） */
const errorResponseSchema = {
  type: "object",
  properties: {
    code: { type: "string", description: "错误码，取值见 A3 §1.2" },
    message: { type: "string" },
  },
  required: ["code", "message"],
} as const;

/**
 * 二进制面手写 spec（`A3` §11.4）：`/api/upload/chunk`、`/api/raw/{nodeId}`
 * 不经 oRPC，无法自动推导 schema，需与生成结果合并。
 */
const binaryPaths = {
  "/api/upload/chunk": {
    post: {
      tags: ["raw"],
      summary: "上传分片（原始流）",
      description:
        "body 为 application/octet-stream 原始分片流，支持并发上传；成功返回已接收分片序号。",
      parameters: [
        {
          name: "uploadId",
          in: "query",
          required: true,
          schema: { type: "string" },
          description: "上传会话 id（`upload.init` 返回）",
        },
        {
          name: "index",
          in: "query",
          required: true,
          schema: { type: "integer", minimum: 0 },
          description: "分片序号，从 0 开始",
        },
      ],
      requestBody: {
        required: true,
        content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      },
      responses: {
        200: {
          description: "分片已接收",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  received: { type: "integer" },
                  etag: { type: "string" },
                },
                required: ["received", "etag"],
              },
            },
          },
        },
        400: {
          description: "参数非法",
          content: { "application/json": { schema: errorResponseSchema } },
        },
        401: {
          description: "未登录",
          content: { "application/json": { schema: errorResponseSchema } },
        },
        404: {
          description: "上传会话不存在",
          content: { "application/json": { schema: errorResponseSchema } },
        },
        409: {
          description: "上传会话已结束",
          content: { "application/json": { schema: errorResponseSchema } },
        },
      },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    },
  },
  "/api/raw/{nodeId}": {
    get: {
      tags: ["raw"],
      summary: "流式下载 / 预览",
      description: "支持 Range 请求返回 206；`dl=1` 触发下载文件名，`inline=1` 供内联预览。",
      parameters: [
        {
          name: "nodeId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "文件节点 id",
        },
        {
          name: "token",
          in: "query",
          required: false,
          schema: { type: "string" },
          description: "短时签名令牌（`preview.url` 返回），与 nodeId 绑定",
        },
        {
          name: "dl",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["1"] },
          description: "置 `1` 时以附件形式下载",
        },
        {
          name: "inline",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["1"] },
          description: "置 `1` 时内联展示",
        },
        {
          name: "range",
          in: "header",
          required: false,
          schema: { type: "string" },
          description: "标准 Range 头，如 `bytes=0-1023`",
        },
      ],
      responses: {
        200: {
          description: "完整文件流",
          content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
        },
        206: {
          description: "Range 分片响应",
          content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
        },
        400: {
          description: "查询参数非法（`token` 为空串，或 `dl` / `inline` 取值不是 `1`）",
          content: { "application/json": { schema: errorResponseSchema } },
        },
        401: {
          description: "未授权",
          content: { "application/json": { schema: errorResponseSchema } },
        },
        403: {
          description: "令牌与资源不匹配",
          content: { "application/json": { schema: errorResponseSchema } },
        },
        404: {
          description: "文件不存在或物理对象缺失",
          content: { "application/json": { schema: errorResponseSchema } },
        },
        416: {
          description: "Range 不可满足",
          content: { "application/json": { schema: errorResponseSchema } },
        },
      },
      security: [{ queryToken: [] }, { cookieAuth: [] }],
    },
  },
} as const;

/** 三个安全方案（`A3` §11.4）：会话 Cookie / Bearer / 签名 URL query token */
const securitySchemes = {
  cookieAuth: {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description: "管理员会话 Cookie",
  },
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    description: "WebDAV / 分享令牌",
  },
  queryToken: {
    type: "apiKey",
    in: "query",
    name: "token",
    description: "短时签名 URL 令牌",
  },
} as const;

/**
 * 生成 OpenAPI 3.1 文档。
 * oRPC 过程由 `.route()` 声明 REST 语义，可被完整推导；
 * 二进制路由（/api/upload/chunk、/api/raw/{nodeId}）不经过 oRPC，
 * 在此以手写 spec 片段合并（`A3` §11.4）。
 */
export async function generateOpenApiDocument(serverUrl: string) {
  const document = await generator.generate(appRouter, {
    info: {
      title: "MyDisk API",
      version: "1.0.0",
      description:
        "私人云盘系统接口。控制面通过 oRPC REST 语义暴露，文件二进制流走 /api/upload 与 /api/raw。",
    },
    servers: [{ url: serverUrl }],
  });

  const components = { ...document.components, securitySchemes };

  return {
    ...document,
    paths: { ...document.paths, ...binaryPaths },
    components,
  };
}
