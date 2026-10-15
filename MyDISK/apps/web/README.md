# web · SolidStart 前端，用户看得见的那一层

|        |                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 状态   | ✅ 已落地（P1，多数页面为占位骨架）                                                                                                  |
| 边界   | 负责页面/路由/组件/样式、客户端会话状态、oRPC 客户端；**不含**服务端逻辑与数据访问（在 `A3`）、不直接连数据库；契约与视觉规范在 `A5` |
| 上游   | `@MyDISK/api`（`AppRouterClient` 类型 + `/rpc`）、`@MyDISK/auth`（浏览器端 client）                                                  |
| 下游   | 无（终端应用）                                                                                                                       |
| 何时读 | 改前端页面 / 组件 / 样式                                                                                                             |

## 这个 crate 是什么

私人云盘的**仪表盘**：所有交互都在这里发生，但真正的读写都通过 `/rpc` 委托给后端，自己不持有数据。

## 核心内容

| 项                       | 说明                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/router.ts`          | `createRouter(fileRoutes(pageRoutes))`，路由由 `virtual:file-routes` 编译期生成                                                              |
| `src/routes/`            | 页面：`index`(跳 `/files`)、`login`、`files`、`trash`、`favorites`、`shares`、`settings/{index,security,storage}`、`admin/users`、`[...404]` |
| `src/App.tsx`            | `QueryClientProvider` + `Router`；客户端挂载时 `ensureSession()`                                                                             |
| `src/components/layout/` | `app-shell`(外壳/导航)、`protected`(登录守卫)、`placeholder`(占位)                                                                           |
| `src/components/ui/`     | 自研组件：`alert`/`button`/`card`/`input`/`icons`                                                                                            |
| `src/lib/session.ts`     | 会话单例：`refreshSession`/`ensureSession`/`signIn`/`signOut`/`useRequireAuth`/`isFounder`                                                   |
| `src/utils/orpc.ts`      | `RPCLink`(打 `/rpc`) + `createORPCClient` + `createTanstackQueryUtils`；SSR 用 `SERVER_URL`，浏览器用同源                                    |
| `src/middleware.ts`      | `createAPIHandler(virtual:file-routes)` 的文件路由 API 处理器                                                                                |
| `src/env.ts`             | varlock 生成：`NODE_ENV` / `VITE_SERVER_URL`                                                                                                 |

## 必须知道的三个设计决定

1. **弃 HeroUI，自研组件（`D2`）**：Solid 2 处于 RC，第三方 UI 库生态缺位，改用 Tailwind v4 + 自研组件，避免被上游断层卡住。
2. **会话只拉一次**：`sessionPromise` 缓存并发请求，`ensureSession()` 幂等；否则每个页面各自打 `/auth/session`。受保护页面统一走 `useRequireAuth()`。
3. **同源 + `credentials:"include"`**：浏览器端把 `/rpc` 指向当前 origin 并带 Cookie；服务端渲染才回退到 `SERVER_URL`，否则跨端口会丢会话。

## 相关

- 前端契约与视觉规范 → 本模块 `docs/ui.md`（`A5`）｜ `D2` ｜ `A6` ｜ `A3`
- 地图 → `AGENTS.md` §2
