# web · SolidStart 前端，用户看得见的那一层

|        |                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 状态   | ✅ 已落地（P1 骨架；P2 增文件管理器主页与上传抽屉、`xstate` 上传编排）                                                               |
| 边界   | 负责页面/路由/组件/样式、客户端会话状态、oRPC 客户端；**不含**服务端逻辑与数据访问（在 `A3`）、不直接连数据库；契约与视觉规范在 `A5` |
| 上游   | `@MyDISK/api`（`AppRouterClient` 类型 + `/rpc`）、`@MyDISK/auth`（浏览器端 client）                                                  |
| 下游   | 无（终端应用）                                                                                                                       |
| 何时读 | 改前端页面 / 组件 / 样式                                                                                                             |

## 这个 crate 是什么

私人云盘的**仪表盘**：所有交互都在这里发生，但真正的读写都通过 `/rpc` 委托给后端，自己不持有数据。

## 核心内容

| 项                       | 说明                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/router.ts`          | `createRouter(fileRoutes(pageRoutes))`，路由由 `virtual:file-routes` 编译期生成                                                                                                   |
| `src/routes/`            | 页面：`index`(跳 `/files`)、`login`、`files/[...path]`（文件管理器）、`trash`、`favorites`、`shares`、`settings/{index,security,storage}`、`admin/users`、`[...404]`              |
| `src/App.tsx`            | `QueryClientProvider` + `Router`；客户端挂载时 `ensureSession()`                                                                                                                  |
| `src/components/layout/` | `app-shell`(外壳/导航)、`protected`(登录守卫)、`placeholder`(占位)                                                                                                                |
| `src/components/ui/`     | 自研组件：`alert`/`button`/`card`/`input`/`icons`                                                                                                                                 |
| `src/components/file/`   | 文件区：`toolbar`(工具栏：上传/文件夹/新建/搜索/排序/视图)、`breadcrumb`、`file-list`、`file-row`、`drop-zone`(全窗口拖拽)                                                        |
| `src/components/upload/` | `upload-drawer`(底部上传抽屉：队列 + 单条进度 + 暂停/继续/停止 + 全局控制)                                                                                                        |
| `src/lib/upload/`        | 上传编排（`D7`）：`item.machine.ts`(每文件机) / `pool.machine.ts`(池编排器) / `store.ts`(模块级单例订阅层) / `idb.ts`(本地持久化) / `transport.ts`(XHR 分片泵) / `fingerprint.ts` |
| `src/lib/format.ts`      | 展示辅助：字节/时间格式化                                                                                                                                                         |
| `src/lib/session.ts`     | 会话单例：`refreshSession`/`ensureSession`/`signIn`/`signOut`/`useRequireAuth`/`isFounder`                                                                                        |
| `src/utils/orpc.ts`      | `RPCLink`(打 `/rpc`) + `createORPCClient` + `createTanstackQueryUtils`；SSR 用 `SERVER_URL`，浏览器用同源                                                                         |
| `src/middleware.ts`      | `createAPIHandler(virtual:file-routes)` 的文件路由 API 处理器                                                                                                                     |
| `src/env.ts`             | varlock 生成：`NODE_ENV` / `VITE_SERVER_URL`                                                                                                                                      |

## 必须知道的四个设计决定

1. **弃 HeroUI，自研组件（`D2`）**：Solid 2 处于 RC，第三方 UI 库生态缺位，改用 Tailwind v4 + 自研组件，避免被上游断层卡住。
2. **会话只拉一次**：`sessionPromise` 缓存并发请求，`ensureSession()` 幂等；否则每个页面各自打 `/auth/session`。受保护页面统一走 `useRequireAuth()`。
3. **同源 + `credentials:"include"`**：浏览器端把 `/rpc` 指向当前 origin 并带 Cookie；服务端渲染才回退到 `SERVER_URL`，否则跨端口会丢会话。
4. **上传编排用框架无关的 `xstate` v5 核心 + 自持订阅层（`D7`）**：`@xstate/solid` 因 peer 范围与 `solid-js/store` 子路径在本项目不可用（`X1` §1 三条实证），故只引 `xstate` 核心；`src/lib/upload/store.ts` 在**模块级** `createActor(...).start()` 并订阅，队列不随路由销毁。分片二进制体走原生 XHR（`transport.ts`）打 `/api/upload/chunk`，不经 oRPC（`D3`）。

## 补充说明（实现细节）

- `/files/[...path]` 的 path 段**直接用节点 id**（如 `/files/<folderId>`），不转成文件夹名——省去逐级名称解析，面包屑由 `file.path` 反查（`A5` §1 的「[...path]」语义按此落地）。
- 上传刷新续传本期为 **C 级（仅元数据 + 重选续传）**：工具栏用 `<input type=file>`，拿不到 `FileSystemFileHandle`，故 A 级（FSA）未启用；`idb.ts` 的 `handles`/`blobs` 接口已备好，见 `S2` #3。

## 相关

- 前端契约与视觉规范 → 本模块 `docs/ui.md`（`A5`）｜ `D2` ｜ `A6` ｜ `A3`
- 地图 → `AGENTS.md` §2
