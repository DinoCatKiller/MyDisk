# @MyDISK/api · oRPC 路由集合，控制面契约的实现

|        |                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P1 `system`/`auth`；P2 增 `connection`/`file`/`upload`/`preview`）                                                                                          |
| 边界   | 负责 oRPC 过程定义、输入校验、权限中间件、错误语义；**不含** HTTP 传输装配（在 `apps/web/src/server`）、数据库表结构（在 `db`）、二进制面（`D3` 规定走 Hono 原生路由） |
| 上游   | `@MyDISK/auth`、`@MyDISK/db`、`@MyDISK/storage`、`@orpc/server`、`zod`（`@MyDISK/queue` / `@MyDISK/mail` 属 P3/P4，届时再接）                                          |
| 下游   | `apps/web/src/server`（`appRouter`）、前端（`AppRouterClient` 类型）                                                                                                   |
| 何时读 | 加接口、改权限中间件                                                                                                                                                   |

## 这个 crate 是什么

一张**接线板**：每个 oRPC 过程既是 RPC 方法、又能投影成 REST 端点（`.route()` 声明），实现只有一份。它是接口清单的唯一实现方，清单本身在 `A3`。

## 核心内容

| 项                          | 说明                                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`              | **包入口**：`appRouter = { system, auth, connection, file, upload, preview }`；导出 `AppRouter` / `AppRouterClient` 类型（`package.json` 的 `"."` 指向它）                                                                                                                   |
| `src/procedure.ts`          | 过程工厂：`o` = `os.$context<Context>()`；`publicProcedure` / `protectedProcedure`（登录且未禁用）/ `founderProcedure`（`role=founder`）                                                                                                                                     |
| `src/routers/system.ts`     | `health`/`installStatus`/`getSettings`/`updateSettings`/`stats`；`INSTALLED_AT_KEY`                                                                                                                                                                                          |
| `src/routers/auth.ts`       | `getSession`/`signIn`/`signOut`/`changePassword`/`updateProfile`/`listAdmins`/`createAdmin`/`deleteAdmin`/`setAdminStatus`                                                                                                                                                   |
| `src/routers/connection.ts` | `list`/`get`（脱敏）；其余 CRUD/sync 属 P3                                                                                                                                                                                                                                   |
| `src/routers/file.ts`       | `list`/`tree`/`path`/`get`/`mkdir`/`rename`/`move`/`remove`/`listTrash`/`restore`/`purge`/`emptyTrash`/`stats`                                                                                                                                                               |
| `src/routers/upload.ts`     | `init`/`complete`/`abort`/`pause`/`resume`/`chunkMeta`/`listPending`/`cleanupExpired`（同指纹复用 + 秒传 + 文件夹建目录）                                                                                                                                                    |
| `src/routers/preview.ts`    | `url`（生成 `/api/raw` 短时签名地址）                                                                                                                                                                                                                                        |
| `src/lib/connections.ts`    | `resolveConnection`（取默认 / 指定连接，校验 `active`）、`driverFor`（按连接造驱动）                                                                                                                                                                                         |
| `src/lib/files.ts`          | `DEFAULT_CHUNK_SIZE`（分片默认大小的唯一来源，`apps/web` 与 `cli` 同源引用）/`readChunkSize`/`extOf`/`basenameOf`/`resolveUniqueName`/`ensureFolderPath`/`collectSubtree`                                                                                                    |
| `src/lib/raw-token.ts`      | `signRawToken`/`verifyRawToken`/`buildRawUrl`（二进制面取流鉴权地基，`apps/web/src/server` 共用）；载荷用 `schemas/raw.ts` 的 `rawTokenPayloadSchema` 校验                                                                                                                   |
| `src/schemas/`              | **所有 Zod schema 的唯一家**：`common.ts`（分页/排序/`queryIntSchema`/`ok`/`pageSchema`）+ 每个 router 一份（`system`/`auth`/`connection`/`file`/`upload`/`preview`）+ 二进制面 `raw.ts`；类型一律 `z.infer`，路由只 `.input()`/`.output()`（无汇总 barrel，按需直取子模块） |
| `src/context.ts`            | `Context` 类型：`db`/`auth`/`adminAuth`/`session`/`headers`/`responseHeaders`/`storageRoot`/`signingSecret`/`requestInfo`                                                                                                                                                    |

## 必须知道的五个设计决定

1. **中间件只写在 `procedure.ts`，不散进各 router**：权限档位是全项目统一约定，router 只声明「我是哪个过程」。这样新增 router 天然继承四档权限，不会漏配。
2. **认证过程要手动回写 `Set-Cookie`**：Better-Auth 的 `auth.api.*` 用 `returnHeaders:true` 拿 header，再经 `appendSetCookies` 写进 `context.responseHeaders`，由 `apps/web/src/server` 层落到最终响应。
3. **`storageRoot` 与 `signingSecret` 由 `apps/web/src/server` 经 `Context` 注入**：`api` 不得 import `apps/*`（依赖单向），但造本地驱动需要存储根、签二进制面令牌需要密钥——故两者作为 Context 字段由调用方传入，签名逻辑（`lib/raw-token.ts`）留在 `api` 供两侧共用。
4. **schema 与实现分家，且对外 DTO 用「显式白名单」**：所有 Zod schema 集中在 `src/schemas/`（含二进制面参数），router 只声明 `.input()` / `.output()`，类型由 `z.infer` 派生（不再手写 DTO 类型 + 映射函数）。对外脱敏一律**逐字段列举**（如 `publicConnectionSchema`），**不用** `fullRow.omit({ 密文 })` 这类黑名单——否则将来给表加一列敏感字段会静默泄进接口。
5. **尚未实现**：`share`/`task` 等 router 已在 `A3` 定义契约，属 P3+；`shareProcedure` 亦未实现。

## 相关

- 接口清单（唯一事实源）→ 本模块 `docs/routers.md`（`A3`）｜ `D3` ｜ `D4` ｜ `D5`
- 地图 → `AGENTS.md` §2
