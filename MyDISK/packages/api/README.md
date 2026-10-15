# @MyDISK/api · oRPC 路由集合，控制面契约的实现

|        |                                                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P1，仅 `system` / `auth` 两个 router）                                                                                                         |
| 边界   | 负责 oRPC 过程定义、输入校验、权限中间件、错误语义；**不含** HTTP 传输装配（在 `server`）、数据库表结构（在 `db`）、二进制面（`D3` 规定走 Hono 原生路由） |
| 上游   | `@MyDISK/auth`、`@MyDISK/db`、`@MyDISK/storage`、`@MyDISK/queue`、`@MyDISK/mail`、`@orpc/server`、`zod`                                                   |
| 下游   | `server`（`appRouter`）、`web`（`AppRouterClient` 类型）                                                                                                  |
| 何时读 | 加接口、改权限中间件                                                                                                                                      |

## 这个 crate 是什么

一张**接线板**：每个 oRPC 过程既是 RPC 方法、又能投影成 REST 端点（`.route()` 声明），实现只有一份。它是接口清单的唯一实现方，清单本身在 `A3`。

## 核心内容

| 项                      | 说明                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`          | `o` = `os.$context<Context>()`；`publicProcedure` / `protectedProcedure`（登录且未禁用）/ `founderProcedure`（`role=founder`） |
| `src/routers/index.ts`  | `appRouter = { system, auth }`；导出 `AppRouter` / `AppRouterClient` 类型                                                      |
| `src/routers/system.ts` | `health`/`installStatus`/`getSettings`/`updateSettings`/`stats`；`INSTALLED_AT_KEY`                                            |
| `src/routers/auth.ts`   | `getSession`/`signIn`/`signOut`/`changePassword`/`updateProfile`/`listAdmins`/`createAdmin`/`deleteAdmin`/`setAdminStatus`     |
| `src/context.ts`        | `Context` 类型：`db`/`auth`/`adminAuth`/`session`/`headers`/`responseHeaders`/`requestInfo`                                    |

## 必须知道的三个设计决定

1. **中间件只写在 `index.ts`，不散进各 router**：权限档位是全项目统一约定，router 只声明「我是哪个过程」。这样新增 router 天然继承四档权限，不会漏配。
2. **认证过程要手动回写 `Set-Cookie`**：Better-Auth 的 `auth.api.*` 用 `returnHeaders:true` 拿 header，再经 `appendSetCookies` 写进 `context.responseHeaders`，由 `server` 层落到最终响应。
3. **只实现了 `system` / `auth`**：`file`/`upload`/`share`/`task`/`connection` 等 router 已在 `A3` 定义契约，属 P2+ 落地；`shareProcedure` 也尚未实现。

## 相关

- 接口清单（唯一事实源）→ 本模块 `docs/routers.md`（`A3`）｜ `D3` ｜ `D4` ｜ `D5`
- 地图 → `AGENTS.md` §2
