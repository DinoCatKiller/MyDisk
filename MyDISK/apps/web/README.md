# web · 单 app（TanStack Start 前端 + Hono `/api` 子系统）

|        |                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P1 骨架、P2 文件管理器与上传抽屉；`D8` 架构迁移 S1–S3 已合入）                                                                                    |
| 边界   | 负责页面/路由/组件/样式、客户端会话状态、oRPC 客户端，以及服务端装配（Hono `/api` 子系统、二进制面、OpenAPI）；**不含**业务数据访问逻辑（在 `A3`）；契约与视觉规范在 `A5` |
| 上游   | `@MyDISK/api`（`AppRouterClient` 类型 + `/api/rpc`）、`@MyDISK/auth`（服务端实例 + 浏览器端 client）、`@MyDISK/db`（服务端连接）                                   |
| 下游   | 无（唯一进程级 app：`apps/*` 只剩它）                                                                                                                       |
| 何时读 | 改前端页面 / 组件 / 样式，或改 API 装配 / 二进制面 / 生产入口                                                                                                |

## 这个 crate 是什么

私人云盘的**仪表盘 + 唯一进程**：浏览器交互全在这里，真正的读写通过 `/api/rpc` 委托给 `@MyDISK/api`；二进制流（分片上传、取流）走 `src/server/` 里挂的 Hono 原生路由（`D3`）。单进程单端口（`:3000`），页面路由与 API 同源，原 `apps/server` 已整体并入 `src/server/`（`D8`）。

## 核心内容

| 项                          | 说明                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/router.tsx`            | `getRouter()`：TanStack Router，路由树由 `src/routeTree.gen.ts` 编译期生成                                                                                                       |
| `src/routes/__root.tsx`     | 根路由：`shellComponent`（`html`/`head` + `<HeadContent />`/`<Scripts />`）与客户端挂载时 `ensureSession()`                                                                        |
| `src/routes/`               | 页面：`index`(跳 `/files`)、`login`、`files/index`(`/files/`)、`files/$`(`/files/$`，参数 `_splat`)、`trash`、`favorites`、`shares`、`settings/{index,security,storage}`、`admin/users` |
| `src/routes/api/$.ts`       | **仅服务端**：`handlers.ANY` 里把 Hono 直挂（`apiApp.fetch(request)`，不改写 path）                                                                                               |
| `src/server/`               | Hono 装配：`app.ts`(`createApiApp()`)、`context.ts`、`config.ts`、`services.ts`、`openapi.ts`、`env.server.ts`、`routes/{raw,upload-chunk}.ts`                                     |
| `scripts/start.mjs`         | 生产入口（`bun run start`）：`Bun.serve` 先服务 `dist/client` 静态资源，未命中再交给 `dist/server/server.js` 的 SSR handler                                                       |
| `src/components/layout/`    | `app-shell`(外壳/导航)、`protected`(登录守卫)、`placeholder`(占位)                                                                                                               |
| `src/components/ui/`        | 自研组件：`alert`/`button`/`card`/`input`/`icons`                                                                                                                                |
| `src/components/file/`      | 文件区：`files-browser`(主页容器)、`toolbar`(上传/文件夹/新建/搜索/排序/视图)、`breadcrumb`、`file-list`、`file-row`、`drop-zone`(全窗口拖拽)                                      |
| `src/components/upload/`    | `upload-drawer`(底部上传抽屉：队列 + 单条进度 + 暂停/继续/停止 + 全局控制)                                                                                                        |
| `src/lib/upload/`           | 上传编排（`D7`）：`item.machine.ts`(每文件机) / `pool.machine.ts`(池编排器) / `store.ts`(模块级单例订阅层) / `idb.ts`(本地持久化) / `transport.ts`(XHR 分片泵) / `fingerprint.ts` |
| `src/lib/format.ts`         | 展示辅助：字节/时间格式化                                                                                                                                                        |
| `src/lib/session.ts`        | 会话单例：`refreshSession`/`ensureSession`/`signIn`/`signOut`/`useRequireAuth`/`isFounder`                                                                                        |
| `src/utils/orpc.ts`         | `RPCLink`(打 `/api/rpc`) + `createORPCClient`；同源 + `credentials:"include"`                                                                                                     |
| `src/env.ts`                | varlock 生成：`NODE_ENV` / `BETTER_AUTH_URL` / `API_REFERENCE_ENABLED` / `WEBDAV_ENABLED`（服务端私密变量经 `src/server/env.server.ts` 取用）                                      |

## 必须知道的四个设计决定

1. **弃 HeroUI，自研组件（`D2`）**：Solid 2 处于 RC，第三方 UI 库生态缺位，改用 Tailwind v4 + 自研组件，避免被上游断层卡住。
2. **会话只拉一次**：`sessionPromise` 缓存并发请求，`ensureSession()` 幂等；否则每个页面各自打 `/auth/session`。受保护页面统一走 `useRequireAuth()`。
3. **单 app 同源，客户端写死 `/api/rpc`**（`D8`）：浏览器端同源 + `credentials:"include"` 带 Cookie，服务端与客户端用同一个 URL；跨端口 CORS 与 `VITE_SERVER_URL`/`SERVER_URL` 双地址已退役。
4. **上传编排用框架无关的 `xstate` v5 核心 + 自持订阅层（`D7`）**：`@xstate/solid` 因 peer 范围与 `solid-js/store` 子路径在本项目不可用（`X1` §1 三条实证），故只引 `xstate` 核心；`src/lib/upload/store.ts` 在**模块级** `createActor(...).start()` 并订阅，队列不随路由销毁。分片二进制体走原生 XHR（`transport.ts`）打 `/api/upload/chunk`，不经 oRPC（`D3`）。

## 补充说明（实现细节）

- `/files/$` 的 `_splat` 段**直接用节点 id**（如 `/files/<folderId>`），不转成文件夹名——省去逐级名称解析，面包屑由 `file.path` 反查（`A5` §1 的「`[...path]`」语义按此落地）。
- Hono 侧路径自带 `/api` 前缀（`/api/upload/chunk`、`/api/raw/:nodeId`、`/api/rpc`、`/api/reference`、`/api/openapi.json`），对外 URL 见 `GUI` §4。
- 构建链的两处非显然点（`GUI` §7 S1 结论）：① `vite.config.ts` 的 `solidWebServerFunctionUrlShim()` 兜住 `@tanstack/solid-start` 对已改名导出的旧名导入；② `scripts/start.mjs` 必须自带 `dist/client` 静态资源服务，Start 的默认 server entry 只做 SSR。
- 上传刷新续传本期为 **C 级（仅元数据 + 重选续传）**：工具栏用 `<input type=file>`，拿不到 `FileSystemFileHandle`，故 A 级（FSA）未启用；`idb.ts` 的 `handles`/`blobs` 接口已备好，见 `S2` #3。

## 相关

- 前端契约与视觉规范 → 本模块 `docs/ui.md`（`A5`）｜ `D2` ｜ `A6` ｜ `A3` ｜ 单 app 拓扑与迁移过程 → `D8` / `GUI`
- 地图 → `AGENTS.md` §2
