# S1 · 当前阶段（概览）

|        |                                                                      |
| ------ | -------------------------------------------------------------------- |
| ID     | `S1`                                                                 |
| 类型   | 状态 · **概览**                                                      |
| 更新   | 2026-10-20（S4：loader/SSR 收口 + 登录态实测完成；仅剩 P2 人工回归） |
| 何时读 | **每次开工第一眼**，5 秒确认「现在做什么」                           |
| 规模   | ~0.5k token                                                          |

> **本文件只写当前阶段的任务。** 任务完成 → 清空并重写；历史交给 git，长期排期见 `RM`。
> 任务跨多个模块时：**这里只给概览**，细节写在相关模块的 `status.md` 里，并从下表链过去。

## 当前任务

**架构迁移（`D8` / `GUI`）** ｜ 状态：🚧 **S4 文档批更 + P2 全量回归**（S1–S3 已通过）

一句话：把前端由 `@solidjs/router` + Nitro 换成 `@tanstack/solid-router` + `@tanstack/solid-start`，两个进程合并为**单 app**，Hono 降为 `/api/$` 子系统（oRPC 保留）；动机是拿到 loader / SSR 数据模型。

| 段  | 事项                                                                                                                             | 门槛                                                                                                    | 细节             |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| S0  | ✅ 5/5 通过（依赖组合可装可跑 / Varlock 与 Start+Tailwind 共存 / Hono `ANY` catch-all / loader SSR 出数 / `@rsbuild/core` 可选） | 全过才进 S1                                                                                             | `GUI` §7 S0 结论 |
| S1  | ✅ 单 app 骨架：`apps/server/src/**` 并入 `apps/web/src/server/`、换 vite 插件、合并 `.env.schema`、端口收敛、自建 prod 入口     | `bun run build` 能起，`/` 返回 SSR 页面                                                                 | `GUI` §7 S1 结论 |
| S2  | ✅ 路由与页面迁移（13 个路由文件 + `App.tsx`/`Document.tsx` 拆入 `__root.tsx`）                                                  | 每页 `check-types` + 手工打开                                                                           | `GUI` §3         |
| S3  | ✅ Hono 挂载 + 对外 URL 重排（`/rpc`→`/api/rpc` 等 3 处变更）                                                                    | `/api/rpc`、`/api/reference`、`/api/openapi.json` 均 200                                                | `GUI` §4         |
| S4  | ✅ **文档批更** + **loader/SSR 收口** + **登录态实测**（`GUI` §7 #6 闭环）                                                       | `check-types`/`lint`/`build` 全绿 + SSR 首屏出真实数据（已过）；上传/续传/目录树/移动/删除/回收站待人工 | `GUI` §7 S4 结论 |

**S4 loader/SSR 收口（已完成，2026-10-20）**：13 个路由中承载数据的两处改为**路由 `loader`**（`/files/`、`/files/$` 经 `src/lib/files-loader.ts`；`/admin/users` 经 `fetchAdmins`），会话由 `__root` 的 `beforeLoad` 服务端读 Cookie 解析后注入**路由 context**（`getRouter()` 每请求实例化，SSR 安全）；`src/server/fns.ts` 用 `createServerFn` 封 4 个取数口（SSR 进程内直调 oRPC）。

- 实测：未登录访问受保护页 SSR 直接 307 到 `/login`；带会话 `GET /files` 返回 200，HTML 含真实文件名（证明 loader 服务端直出）；`/files/<folderId>` 亦 SSR 带出面包屑；`/api/openapi.json`/`/api/reference` 均 200。`bun run check-types` / `bunx oxlint` / `bun run build` 全绿。
- 遗留：上传/续传/目录树/移动/删除/回收站需要人工回归。

**S3 遗留（已修复）**：`/api/openapi.json` 曾返回 500，两个叠加原因已解决 —— `file.move` 的 REST 路径与输入 schema 不匹配（改为 `POST /files/move`，见 `A3` §11.3），以及 Varlock 响应泄漏扫描把 `STORAGE_ROOT` 的字面值误判为泄漏（`apps/web/.env.schema` 改用 `@sensitive={preventLeaks=false}`）。详见 `GUI` §7 结论 #7。

## 挂起（迁移期间停手）

**P2 收尾**：后端 + 前端主链路已落地（类型检查 / lint / build 全绿），⬜ 待人工联调，⬜ 回收站 / 收藏 / 移动 UI 未接线。迁移会重写 web 路由层，P2 未接线项**等 S4 之后再做**，避免白改。

## 阻塞

无 —— 两条前置已清（`D8` 已批准；工作区既有未提交改动已归集成一个 commit 并建迁移分支）。

## 上一阶段

- **P2 上传与文件管理（2026-10-16）**：`@MyDISK/storage` 本地驱动真 multipart + 路径穿越防护；`@MyDISK/db` `upload_session` 秒传 / `uploadedParts` 原子追加 / GC；`server` + `@MyDISK/api` 二进制面 `/api/upload/chunk`、`/api/raw/:nodeId`（签名令牌 + Range）与 4 个 router；`web` 文件管理器主页 + xstate 上传抽屉。详见 `A3` §5–§7、`A5`、`X1`、`D7`。
- **P0 地基 + P1 骨架可跑 完成（2026-09-14，commit `2b0eb1f`）**：db schema（19 表）与本地存储驱动落地；`@MyDISK/queue` 与 `@MyDISK/mail` 基础实现、`@MyDISK/cli` install 流程打通；`authRouter`/`systemRouter` + Better-Auth「禁注册 + founder」接入。

## 相关

- 里程碑与排期定义 → `RM` ｜ 未决问题 → `S2` ｜ 地图 → [`AGENTS.md`](AGENTS.md) §2
