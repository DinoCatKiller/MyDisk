# @MyDISK/auth · Better-Auth 封装，禁注册 + founder 体系

|        |                                                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P1）                                                                                                                                           |
| 边界   | 负责创建认证实例、drizzle 适配、user 扩展字段、Cookie 属性；**不含**对外端点（`/api/auth/*` 不暴露，见 `D4`）、业务路由（在 `A3`）、表结构定义（在 `A2`） |
| 上游   | `@MyDISK/db`（`Database` 与 `schema/auth`）、`better-auth`                                                                                                |
| 下游   | `api`（运行时 `auth`/`adminAuth`）、`server`（`services`）、`cli`（建号）、`web`（浏览器端 client）                                                       |
| 何时读 | 改登录 / 会话 / 管理员体系                                                                                                                                |

## 这个 crate 是什么

系统的**门锁**：只负责「验证你是谁」，并把结果交给上层。系统不提供公开注册——门只从内侧开（`D4`）。

## 核心内容

| 项                                 | 说明                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `createAuth(env, db, opts?)`       | `betterAuth` + `drizzleAdapter(provider:"pg")`；`opts.allowSignUp`、`opts.desktopOrigins`                                                 |
| `disableSignUp`                    | `= !allowSignUp`，**默认禁注册**；`minPasswordLength: MIN_PASSWORD_LENGTH`                                                                |
| `src/password.ts`                  | `MIN_PASSWORD_LENGTH = 8`：密码策略的**唯一来源**，`api` 的入参 schema、CLI 与前端表单校验都从这取（该模块零依赖，可安全在浏览器 import） |
| `user.additionalFields`            | `role`(默认 `admin`)/`status`(默认 `active`)/`mustChangePassword`/`lastLoginAt`/`lastLoginIp`，全部 `input:false`                         |
| `advanced.defaultCookieAttributes` | 生产 `sameSite:"none"`+`secure`+`httpOnly`；开发 `lax`+`httpOnly`                                                                         |
| `src/client.ts`                    | `createClient(baseURL)`，供 `web` 使用                                                                                                    |
| `Auth` 类型                        | `createAuth` 的返回类型，供各包引用                                                                                                       |

## 必须知道的三个设计决定

1. **两个实例而非一个开关**：`auth`（`allowSignUp:false`，运行时）与 `adminAuth`（`allowSignUp:true`，仅供创始人建号）。用「实例能力」区分谁能建号，比全局布尔更难被误开。
2. **扩展字段一律 `input:false`**：`role`/`status` 等不允许客户端在注册或更新时注入，否则等于开放提权。
3. **Cookie 属性按环境分流**：生产 `sameSite:"none"`+`secure`、开发 `lax`；单 app 同源后（`D8`）跨端口不再存在，`lax` 已足够，此处保持不动以免影响已在生产签发的会话。

## 相关

- `D4`（单管理员 / founder 唯一）｜ `A3` §3 ｜ `A2` §3 ｜ `A1` §7
- 地图 → `AGENTS.md` §2
