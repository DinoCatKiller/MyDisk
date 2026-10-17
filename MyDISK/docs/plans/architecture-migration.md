# GUI · 架构迁移计划（Start 单 app + Hono `/api` 子系统）

|        |                                                              |
| ------ | ------------------------------------------------------------ |
| ID     | `GUI`                                                        |
| 类型   | 计划（执行前的改动面与验证门槛）                             |
| 状态   | 进行中（`D8` 已批准；S0 旁路 spike **已通过**，当前 **S1**） |
| 更新   | 2026-10-17                                                   |
| 何时读 | 执行本迁移前；想知道「改哪些文件、按什么顺序、什么算通过」时 |
| 规模   | ~2.5k token                                                  |

> 决策与理由 → `D8`。本文只写**怎么改**、**改哪些**、**什么算通过**。
> 进度状态不写这里；开工后进 `S1`。

## TL;DR

- 目标态：**一个进程、一个端口**。TanStack Start 承载 SSR / loader / 页面路由；Hono 作为 API 子系统挂 `routes/api/$.ts`（内含 oRPC `/rpc`、分片上传、取流、OpenAPI、未来 WebDAV）。
- `packages/*`（含 `@MyDISK/api` 的 6 个 router）**不动**；只重搭 `apps/web` 的构建链、路由层与 `apps/server` 的装配归宿。
- 对外 URL 有 **3 处变更**，其余不变（见 §4）。
- 必须先过 **S0 旁路 spike**（5 个验证点）；任一不通过就回到 `D8` 重新评审。
- 全流程在一条分支上原子推进，**不做半迁移状态**。

## 1. 目标态拓扑

```
                        ┌──────────────────────────────────────────────┐
   浏览器 ──:3000──────▶ │ 单 app（原 apps/web + apps/server 合并）      │
                        │                                              │
                        │  TanStack Start                              │
                        │   ├─ createFileRoute + loader + SSR          │
                        │   ├─ QueryClientProvider（root 级，预填）    │
                        │   └─ routes/api/$.ts  ── catch-all ──┐       │
                        │                                       ▼       │
                        │                          Hono（API 子系统）     │
                        │                           ├─ /rpc        oRPC   │
                        │                           ├─ /upload/*   分片   │
                        │                           ├─ /raw/*      取流   │
                        │                           ├─ /reference  OpenAPI│
                        │                           └─ /openapi.json       │
                        └───┬──────────┬──────────┬────────────────────┘
                            │          │          │
                   PostgreSQL│    Redis │          │ 存储驱动
                       :5432  │    :6379 │          ▼
                   ┌──────────▼──┐ ┌─────▼─────┐ ┌──────────────────┐
                   │  pstorage   │ │  BullMQ   │ │ Local / COS /    │
                   └─────────────┘ └─────┬─────┘ │ OSS / S3 兼容     │
                                         │       └──────────────────┘
                                 ┌───────▼────────┐
                                 │ apps/worker    │ 仍为独立进程（`S2`#2）
                                 └────────────────┘
```

`/dav`（P4）单独挂 `routes/dav/$.ts`，**不进** `/api` 前缀（避免与 API 子系统共享前缀后语义混乱）。

## 2. 目标态目录（只列变化）

```
apps/web/
├── src/
│   ├── router.tsx              # ⬜ 新增：createRouter(routeTree)
│   ├── routeTree.gen.ts        # ⬜ 由插件自动生成，勿手改
│   ├── routes/
│   │   ├── __root.tsx          # ⬜ 新增：shell（原 Document.tsx）+ QueryClientProvider + ensureSession
│   │   ├── api/$.ts            # ⬜ 新增：Hono catch-all
│   │   ├── dav/$.ts            # ⬜ P4
│   │   └── …（原页面，按 §3 改名）
│   ├── server/                 # ⬜ 新增：原 apps/server 源码的归宿
│   │   ├── app.ts              # 原 index.ts 的 Hono 装配（导出厂函数，不再 default export 进程入口）
│   │   ├── context.ts  services.ts  config.ts  openapi.ts
│   │   ├── env.ts / env.server.ts
│   │   └── routes/{upload-chunk,raw}.ts
│   ├── middleware.ts           # ❌ 删除（filesystem-routing 专用）
│   └── router.ts               # ❌ 删除
├── .env.schema                 # 合并原 apps/server/.env.schema（见 §5）
└── vite.config.ts              # 构建链切换（见 §6）
apps/server/                    # ❌ 整体退役（源码已并入 apps/web/src/server）
```

> `apps/` 只留一个进程级 app —— 这样 `A1` §2.2 的「`apps/* → packages/*`」无需为 `apps → apps` 开例外。
> `apps/web` 的目录名已与职责不符（现在含服务端装配），是否统一改名留到迁移完成后单独处理，**不阻塞**。

## 3. 路由文件映射（`@solidjs/router` + `filesystem-routing` → TanStack Router）

| 现行文件                       | 现路径               | 新文件                                               |
| ------------------------------ | -------------------- | ---------------------------------------------------- |
| `routes/index.tsx`             | `/`                  | 同名                                                 |
| `routes/login.tsx`             | `/login`             | 同名                                                 |
| `routes/files/[...path].tsx`   | `/files/*`           | `routes/files/$.tsx`                                 |
| `routes/favorites.tsx`         | `/favorites`         | 同名                                                 |
| `routes/shares.tsx`            | `/shares`            | 同名                                                 |
| `routes/trash.tsx`             | `/trash`             | 同名                                                 |
| `routes/settings/index.tsx`    | `/settings`          | `routes/settings/index.tsx`                          |
| `routes/settings/security.tsx` | `/settings/security` | 同名                                                 |
| `routes/settings/storage.tsx`  | `/settings/storage`  | 同名                                                 |
| `routes/admin/users.tsx`       | `/admin/users`       | 同名                                                 |
| `routes/[...404].tsx`          | 兜底                 | `__root.tsx` 的 `notFoundComponent` + `routes/$.tsx` |
| `App.tsx`                      | 应用根               | 拆入 `__root.tsx`（shell / head / provider）         |
| `Document.tsx`                 | SSR 外壳             | 并入 `__root.tsx` 的 shell 与 `head`                 |

每个页面从「`component` 里 `createQuery` 拉数」改为「`loader` 预填 `queryClient` + `component` 读缓存」：

- 阶段一 loader 走同源 `/api/rpc`（复用 `src/utils/orpc.ts` 的 `RPCLink`，URL 由 `${VITE_SERVER_URL}/rpc` 改为 `/api/rpc`）；
- 服务端请求时是否改用**进程内直调**（`@orpc/server` 的 `call(appRouter, ctx)`，省一跳 HTTP）作为优化项，落地时验证。

## 4. 对外 URL 变更（仅 3 处）

| 现在                   | 迁移后              | 是否变 |
| ---------------------- | ------------------- | ------ |
| `/rpc`                 | `/api/rpc`          | ⚠️ 变  |
| `/api/upload/chunk`    | `/api/upload/chunk` | 不变   |
| `/api/raw/:nodeId`     | `/api/raw/:nodeId`  | 不变   |
| `/api-reference`       | `/api/reference`    | ⚠️ 变  |
| `/openapi.json`        | `/api/openapi.json` | ⚠️ 变  |
| `/dav`（P4）           | `/dav`              | 不变   |
| `/`（Hono 的问候文本） | 删除                | —      |

Hono 内部路径同步重排（去掉已在 `route("/api", …)` 前缀里重复的 `/api`）：`/api/upload/chunk` → `/upload/chunk`、`/api/raw/:id` → `/raw/:id`、`/api-reference` → `/reference`。`/rpc` 与 `/openapi.json` 内部不变。

## 5. 环境变量与端口

| 变量                                     | 处置                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| `VITE_SERVER_URL`                        | ❌ 退役（同源，客户端写死 `/api/rpc`）                       |
| `CORS_ORIGIN`                            | ❌ 退役（同源免 CORS；确认无第三方跨域消费方后再删中间件）   |
| `PORT`                                   | 单端口，建议沿用 `3000`；web 的 `3001` 退役                  |
| `BETTER_AUTH_URL` / `SERVER_URL`         | 指向单 app 地址，二者合一（待确认是否留两个名字）            |
| 其余（`DATABASE_URL` / `REDIS_URL` / …） | 原样从 `apps/server/.env.schema` 迁入 `apps/web/.env.schema` |

改完 schema 必须 `bun run env:generate`（Varlock）。

## 6. 构建链与依赖

**依赖增删（`apps/web/package.json`）**

| 包                                     | 版本            | 动作                                                                                                                                                                                     |
| -------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tanstack/solid-router`               | `2.0.0-rc.8`    | ➕ 新增                                                                                                                                                                                  |
| `@tanstack/solid-start`                | `2.0.0-rc.8`    | ➕ 新增（含 `.../plugin/vite`）                                                                                                                                                          |
| `solid-js` / `@solidjs/web`            | `2.0.0-rc.15`   | 🔁 抬版本（rc.7 → rc.15）：router 要求 `@solidjs/web ^2.0.0-rc.8`（内嵌 rc.15），不抬会出现双份渲染器；`overrides` 里 `@solidjs/compiler` / `@solidjs/signals` 同步抬（见 §7 S0 结论 1） |
| `@solidjs/vite-plugin`                 | `3.0.0-next.39` | ✅ **保留**（Start 不自带 Solid JSX 编译，实测必需；仅去掉 `start` 选项）                                                                                                                |
| `@tanstack/solid-router-ssr-query`     | 见 `S2`         | ⏸ 阶段一**不引入**                                                                                                                                                                       |
| `@solidjs/router` `filesystem-routing` | —               | ➖ 删除                                                                                                                                                                                  |
| `nitro`                                | —               | ➖ 删除                                                                                                                                                                                  |
| `@tanstack/solid-query` / `query-core` | 现有            | 保留（配对问题见 `S2`）                                                                                                                                                                  |
| `@orpc/*` `varlock` `tailwindcss`      | 现有            | 保留                                                                                                                                                                                     |

**`vite.config.ts`**：移除 `nitro/vite`、`filesystem-routing/vite`；`@solidjs/vite-plugin` 改为 `solid({ ssr: true, extensions: [".jsx", ".tsx"] })`（不再传 `start.middleware`）；接入 Start 的 vite 插件。实测可用顺序：`varlockVitePlugin({ ssrInjectMode: "auto-load" })` → `tanstackStart({})` → `solid(...)` → `tailwindcss()`。

**scripts**：`start` 由 `node .output/server/index.mjs` 改为**自建 Node/Bun 入口** —— Start 产物 `dist/server/server.js` 只导出 fetch handler（`createServerEntry`），**不自带监听**（见 §7 S0 结论附带回填）；`dev` 仍是 `vite dev`。

**生成物**：`src/routeTree.gen.ts` 由插件**自动**生成，**无需手动 generate 命令** —— 与项目「无强制 codegen 步骤」的约定不冲突；是否入库随插件推荐（落地时定）。

## 7. 执行顺序

### S0 · 旁路 spike（必过门槛，先不删旧代码）

在仓库内建一次性最小工程（如 `spike/start-solid/`，不进 turbo 图、验完即删），逐条取结论：

1. 依赖组合能否安装：`@tanstack/solid-start@2.0.0-rc.8` + `@tanstack/solid-router@2.0.0-rc.8` 与现有 `solid-js@2.0.0-rc.7`、`vite@^8`；
2. Start 的 vite 插件能否与 `varlockVitePlugin`（SSR 注入）、`@tailwindcss/vite` 共存；
3. `routes/api/$.ts` 能否把 Hono 整体挂上（`ANY` 通配方法或逐方法映射，见 `S2`）；
4. 一个 loader 页面能 SSR 出真实数据；
5. `@rsbuild/core ^2.0.0` peer 是否必装。

任一不通过 → **停止迁移**，结论回写 `D8` 并重新评审。

**S0 结论（2026-10-17 实测，5/5 通过；一次性工程建在仓外、验完即删）**

| #   | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 装上即用：`@tanstack/solid-start@2.0.0-rc.8` + `@tanstack/solid-router@2.0.0-rc.8` + `vite@8` 可安装可运行。**但 `@solidjs/web` 会双份**（router 内嵌 rc.15，本项目钉 rc.7），S1 按 §6 抬到 `2.0.0-rc.15` 消除；实测 rc.7 也能跑且水合无报错。11 条 peer 警告来自 router 拉入的 Solid 1 线包（`@solid-primitives/refs`、`@solid-devtools/logger`、内嵌 `@solidjs/meta@0.29.4`），不阻塞。                                                                                    |
| 2   | 插件共存 OK：`varlockVitePlugin({ ssrInjectMode: "auto-load" })` + `tanstackStart()` + `@solidjs/vite-plugin(ssr:true)` + `@tailwindcss/vite` 同挂无冲突（dev 样式注入与 build 产物均正常）。**但 `auto-load` 不会注入 Start 的默认 server entry** → 服务端取 env 必须沿用现有模式：`src/server/env.server.ts` 内 `import "varlock/auto-load"; export { ENV as env } from "./env";`；`loader` 服务端 / 客户端都跑，**不得** import 它。附带确认 varlock 敏感值泄漏防护生效。 |
| 3   | **`handlers: { ANY }` 受支持**（`tsc --noEmit` 零错误；GET / POST / 流式响应全过）→ `routes/api/$.ts` 用单键 `ANY` 委托 Hono，无需逐方法映射（`S2` #4 闭环）；挂法沿用 §4 的 `root.route("/api", apiApp)`。                                                                                                                                                                                                                                                                  |
| 4   | loader 数据出现在**原始 HTML**（首屏 SSR 直出）；水合后浏览器控制台零错误、零失败请求。                                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | `@rsbuild/core` 是 **optional peer**，**不必装**，只走 Vite 线即可（dev / build 全过）。                                                                                                                                                                                                                                                                                                                                                                                     |

**S0 附带回填（S1 要处理）**

- **prod 入口需自建**：`vite build` 产物 `dist/server/server.js` 只导出 fetch handler，不自带监听 → 见 §6 的 scripts 说明，需自建 Node/Bun 入口或改用 `vite preview`。
- 构建期 `[IMPORT_IS_UNDEFINED] solid-js/dist/server.js 无 OBSERVE 导出` 警告来自 `solid-router` 的 `Transitioner`（源码已有 `!== undefined` 守卫），属静态分析误报，不阻塞。
- 版本坐标：`@tanstack/solid-router` / `@tanstack/solid-start` 的 rc 线最新均为 `2.0.0-rc.8`；`@tanstack/solid-query` rc 线为 `6.0.0-rc.5`（本项目在 rc.3，`S2` #6 一并评估）。

### S1 · 单 app 骨架

- 建 `apps/web/src/server/`，把 `apps/server/src/**` 整体迁入（`index.ts` 改为导出厂函数 `createApiApp()`）；删除 `apps/server`。
- 新建 `src/router.tsx` + `src/routes/__root.tsx`；删 `src/router.ts`、`src/middleware.ts`。
- 切换 `vite.config.ts` 与依赖；合并 `.env.schema`；端口收敛到单端口。
- 出口：`bun run build` 能起，`/` 返回 SSR 页面（可先空壳）。

### S2 · 路由与页面迁移

- 按 §3 表逐个改路由文件；`App.tsx` / `Document.tsx` 的能力拆入 `__root.tsx`。
- `src/utils/orpc.ts` 的 URL 改 `/api/rpc`，`getServerUrl` 里的双地址逻辑（`VITE_SERVER_URL` / Vercel 分支）删掉。
- 页面逐个把 `createQuery` 改为 `loader` + 缓存读取（`files/$.tsx` 优先，它承载 P2 主链路）。
- 每次改完跑 `bun run check-types` + 手工打开该页面。

### S3 · Hono 子系统挂载

- `routes/api/$.ts` 委托 Hono（`rootApp.route("/api", apiApp)`）；按 §4 重排 Hono 内部路径。
- 迁 `openapi.json` / `/api-reference` 到 `/api` 前缀下；补 `/dav` 的挂载位（P4 才填实现）。
- 出口：`/api/reference` 能打开，`/api/rpc` 能被前端客户端调通。

### S4 · 文档与回归

- 文档同批更新：`A1`（拓扑 / 目录 / 端口 / env / CORS）、`A3`（URL 前缀）、`A5`（路由写法 / loader）、`RM`（是否新增里程碑）、各模块 `README.md`、`AGENTS.md` §2 状态列、`S1` 重写。
- 回归门槛：`check-types` / `lint` / `build` 全绿；P2 手工用例全过（上传 → 断网重连断点续传 → 刷新后队列恢复 → 目录树 / 列表 / 网格 → 拖拽 → 移动 / 重命名 / 删除 / 属性 → 回收站）；`/api/reference` 与 `openapi.json` 可访问；登录 / 会话（`D4`）不回归。

## 8. 回滚

**不是可回退的增量迁移** —— S1 起就进入半迁移状态。因此：全流程在**独立分支**推进，合并前全绿；要回退就 revert 该次合并，不做「新旧并存」的兼容层（`D6`：不留历史债）。

## 9. 风险

| 风险                                        | 影响                | 应对                                                         |
| ------------------------------------------- | ------------------- | ------------------------------------------------------------ |
| `rc.8` 与本项目 `rc.7` 的 peer 边界不稳     | 装不上 / 运行期怪象 | S0 验证点 1，且锁版本                                        |
| Start 的 vite 插件与 Varlock SSR 注入不兼容 | 服务端读不到 env    | S0 验证点 2                                                  |
| `@rsbuild/core` peer 必装，构建链被迫改变   | 构建配置重做        | S0 验证点 5；接受则记录进本计划                              |
| P2 已交付主链路面大                         | 回归遗漏            | §7 S2 逐页改 + S4 手工用例清单                               |
| Hono 路径重排漏改                           | 数据面 404          | §4 表逐条核对 + `/api/upload/chunk`、`/api/raw/:id` 显式用例 |
