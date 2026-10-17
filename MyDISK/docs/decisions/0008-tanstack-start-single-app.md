# ADR-0008：前端迁 TanStack Start —— 单 app 承载 SSR，Hono 降级为 `/api` 子系统

|        |                                                                               |
| ------ | ----------------------------------------------------------------------------- |
| ID     | `D8`                                                                          |
| 类型   | 决策（**只增不改**）                                                          |
| 状态   | **提案**（评审中，代码暂不动）                                                |
| 更新   | 2026-10-17                                                                    |
| 何时读 | 想质疑「前端路由 / SSR 载体」「单 app 拓扑」「oRPC 是否被 `createServerFn` 取代」时 |
| 规模   | ~1.3k token                                                                   |

## 背景

现状（`A1` §1）是**两个进程**：`apps/web`（SolidStart + Vite + Nitro，:3001）与 `apps/server`（Hono，:3000），浏览器跨端口访问 `/rpc`、`/api/upload/*`、`/api/raw/*`。

问题不在「能不能跑」，而在**数据模型**：P2 已交付的页面（`A5`）全部是「客户端 `createQuery` 拉数」，**没有 loader / SSR 数据装载** —— 首屏要等 JS 起来才取数，刷新续传（`X1`）也因此多绕一圈。`D2` 定稿的 SSR 载体是 Nitro，但 `@solidjs/router` 只给路由，**不给 loader 与 server function**，这个缺口无法在现状下补。

外部条件已变：TanStack 于 2026-04 发布《Solid 2.0 Beta Support in TanStack Router, Start, and Query》，把 Start / Router / Query 推到 Solid 2 线；实测 `@tanstack/solid-start@2.0.0-rc.8` 与 `@tanstack/solid-router@2.0.0-rc.8` 的 peer 接受 `solid-js >=2.0.0-0 <3.0.0`，本项目在 `solid-js@2.0.0-rc.7` 范围内 —— 此前「Solid 2 太新、Start 没跟上」这条挡住 Start 的理由**已不成立**。

前置约束：`D1`（Bun / Hono / oRPC / Drizzle / PG / Redis）不变；`D5`（对外 OpenAPI 3.1）必须继续成立；`D3`「二进制不走 JSON-RPC」必须继续成立；`packages/*` 不得 import `apps/*`（`A1` §2.2）；`D2` 的 Tailwind v4 + 自研组件不受影响。

## 备选方案

| 方案             | 说明                                                                                                                              | 优点                                                                 | 缺点                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **A（选中）**    | 前端换 `@tanstack/solid-router` + `@tanstack/solid-start`；**合并为单 app**：Start 承载 SSR / loader / 页面路由，Hono 挂 `/api/$` 作 API 子系统（oRPC + 数据面 + OpenAPI + 未来 WebDAV） | 拿到 loader / SSR 数据模型；单进程单端口、同源免 CORS；oRPC 与 `D5`/`A3` 原样保留 | 两个 app 的入口与构建链要重搭；路由文件与页面写法要重写；P2 已交付链路回归面大     |
| B                | 保留 `@solidjs/router`，只把 `apps/server` 并进 web                                                                               | 改动最小                                                             | **拿不到 loader / server function** —— 动机（数据模型）不解决，等于白改           |
| C                | 换 Next.js + React                                                                                                                | 生态最成熟                                                           | 与 `D2`（SolidJS + 自研 UI）正面冲突，全量重写；推翻 `D1` 的前端选型              |
| D（现状）        | 维持两进程 + `@solidjs/router`                                                                                                    | 零成本                                                               | 首屏数据模型缺失；跨端口 CORS、双地址（`VITE_SERVER_URL`）长期维护                |

## 决定

**采用 A。三层职责按此切分：**

| 层             | 负责                                                    | 落地                                                                 |
| -------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| SolidJS 前端   | 页面、组件、交互、状态                                  | `createFileRoute` + `loader` + `@tanstack/solid-query`               |
| TanStack Start | 业务入口、SSR、数据装载、页面路由、页面内动作           | `@tanstack/solid-start` 的 server entry + server routes / functions  |
| Hono           | 复杂 HTTP、中间件、流式与二进制、第三方 webhook、开放 API | 挂在 `routes/api/$.ts` 的 catch-all 上                               |

**最关键的理由：本次动机是 loader / SSR 数据模型，而这只有 Start 能提供（`@solidjs/router` 没有 loader）；既然 Start 同时能承载服务器，就没有理由再留第二个进程 —— 但 `D3` 要求二进制不走 oRPC，所以 Hono 不是被替代，而是降级为 Start 内的 API 子系统；`D5` 的 OpenAPI 出口只能继续由 oRPC 提供（`createServerFn` 无 OpenAPI 导出能力，接不了班）。**

刻意收窄：

- **不**引入第二套接口契约 —— 页面 `loader` 复用 `@MyDISK/api` 的 oRPC 客户端（客户端走同源 `/api/rpc`），**不**用 `createServerFn` 把同语义接口重写一遍；`createServerFn` 只预留给「纯页面内动作、永不对外」的场景。
- **不**动 `packages/api`（6 个 router 与装配链原样保留）；**不**动 `D4`（单管理员）、`D5`（OpenAPI 3.1）、`D7`（xstate 上传编排）。
- **不**采用 TanStack Start 的 stable 线（`1.169.3`）—— 它适配 Solid 1，与本项目 `solid-js@2.0.0-rc.7` 不兼容；必须走 `2.0.0-rc` 线。

## 取代关系（ADR 只增不改，旧文件保留）

- `D2` 的「SSR 载体 = SolidStart + Vite + **Nitro**」「路由 = `@solidjs/router`」两条被本 ADR 取代；`D2` 的**核心结论（Tailwind v4 + 自研组件、弃 React 生态 UI 库）继续有效**。
- `D3` 的**拓扑描述**（两个物理隔离 app、跨端口访问）被取代；`D3` 的**核心结论（控制面 / 数据面分离、二进制不走 JSON-RPC）继续有效** —— 改为单 app 内的两条路由族（`/api/rpc` 与 `/api/upload/*`、`/api/raw/*`）。
- `D1` 不受影响（Bun / Hono / oRPC / Drizzle / PG / Redis 全保留）。

## 影响

- 正面：首屏由 loader 装载、SSR 直出；单进程单端口，`VITE_SERVER_URL` 与 CORS 配置退役；前后端同源，`AppRouterClient` 类型链（`A3`）不变。
- 代价 / 后续动作：`apps/web` 构建链由 Nitro 换为 Start 的 vite 插件；`@solidjs/router` + `filesystem-routing` 退役；路由文件按 TanStack 约定重写（`files/[...path].tsx` → `files/$.tsx` 等）；`apps/server` 的 Hono 装配、context、env 迁入单 app；对外 URL 有三处变更（见 `GUI`）。
- 排期：本 ADR 为**提案**；批准后按 `GUI` 分阶段执行，P2 已交付主链路全部在回归范围内。

## 未决项

（已登记到 `S2`；此处只列入口）

- Start Solid v2 的 server route 是否支持通配方法键（`ANY`），还是必须逐方法映射。
- `@tanstack/solid-start@2.0.0-rc.8` 的 peer `@rsbuild/core ^2.0.0` 是否必装，还是可只走 Vite 线。
- `@tanstack/solid-router-ssr-query` 没有 rc 线（Solid 2 线仅 `2.0.0-beta.12`），与 `@tanstack/solid-query@6.0.0-rc.3` 如何配对；阶段一是否先不用它（`loader` + 手动预填 `queryClient`）。
