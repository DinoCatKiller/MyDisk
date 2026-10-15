# server · HTTP 入口，把 Hono、oRPC、OpenAPI 装配起来

|        |                                                                                                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P1 装配；P2 增二进制面 `/api/upload/chunk`、`/api/raw/:nodeId` 与手写 OpenAPI 片段合并）                                                                                                      |
| 边界   | 负责 Hono 装配、CORS/logger、挂载 oRPC（`/rpc`）、OpenAPI（`/api-reference` + `/openapi.json`）、请求上下文与响应头回写、二进制面路由；**不含**业务逻辑（在 `A3`）、数据模型（在 `A2`）、前端（在 `A5`） |
| 上游   | `@MyDISK/api`、`@MyDISK/auth`、`@MyDISK/db`、`@MyDISK/storage`（经 `api/lib` 间接）、`drizzle-orm`                                                                                                       |
| 下游   | 浏览器/前端经 `/rpc` 调用；无任何 package 反向依赖它                                                                                                                                                     |
| 何时读 | 改路由装配、OpenAPI、上传下载流                                                                                                                                                                          |

## 这个 crate 是什么

像一所**传达室**：不处理业务，只决定谁能进门、走哪条通道、把回执（会话 Cookie）带回去。业务判断全在 `@MyDISK/api`。

## 核心内容

| 项                           | 说明                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`               | Hono 装配：`logger`/`cors`；`RPCHandler`(前缀 `/rpc`)、`OpenAPIHandler`(前缀 `/api-reference`)、`GET /openapi.json`、`GET /`；把过程内 `Set-Cookie` 合并回最终响应                                                             |
| `src/services.ts`            | `getDb()`；`auth`（禁注册）与 `adminAuth`（允许建号）两实例                                                                                                                                                                    |
| `src/context.ts`             | `createContext`：注入 `db`/`auth`/`adminAuth`/`session`/`headers`/`responseHeaders`/`storageRoot`/`signingSecret`/`requestInfo`(ip、ua)                                                                                        |
| `src/routes/upload-chunk.ts` | `POST /api/upload/chunk?uploadId&index`：session Cookie 鉴权 → 驱动 `multipart.uploadPart` → 原子追加 `uploaded_parts`                                                                                                         |
| `src/routes/raw.ts`          | `GET/HEAD /api/raw/:nodeId`：签名 token 或 Cookie 双鉴权 → Range → 200/206/416；`dl=1` 触发下载文件名                                                                                                                          |
| `src/config.ts`              | `serverConfig`：`projectRoot`/`port`/`redisUrl`/`storageRoot`/`uploadChunkSize`/`encryptionKey`/`apiReferenceEnabled`/`webdavEnabled`                                                                                          |
| `src/env.server.ts`          | 经 varlock 加载并透出 `env`                                                                                                                                                                                                    |
| `src/openapi.ts`             | `generateOpenApiDocument`：`OpenAPIGenerator` + Zod→JSON Schema（3.1），并合并二进制面**手写 spec**（`/api/upload/chunk`、`/api/raw/{nodeId}`）与三个 security scheme（`cookieAuth`/`bearerAuth`/`queryToken`），见 `A3` §11.4 |

## 必须知道的三个设计决定

1. **控制面 / 数据面双协议（`D3`）**：8MB 分片走 JSON-RPC 会 base64 膨胀 33% 且内存翻倍，所以分片上传、流式下载、预览取流走 Hono 原生路由。P2 已落地 `/api/upload/chunk` 与 `/api/raw/:nodeId`（注册在 oRPC 中间件**之前**，命中即返回）；`/api/raw/share/*` 与 `/dav/*` 属 P3/P4。
2. **`Set-Cookie` 必须手动合并**：oRPC 过程里 Better-Auth 返回的响应头不会自动进最终响应，过程只把它写进 `context.responseHeaders`，由 `index.ts` 逐个 append。漏掉这步登录 Cookie 就丢了。
3. **`/api/auth/*` 不对外暴露（`D4`）**：认证只走 `authRouter`，避免绕过创始人约束的旁路端点。

## 相关

- `A1`（拓扑 / 环境变量）｜ `A3` §7 / §11（二进制面与 OpenAPI）｜ `D3` ｜ `D5`
- 地图 → `AGENTS.md` §2
