# S1 · 当前阶段（概览）

|        |                                            |
| ------ | ------------------------------------------ |
| ID     | `S1`                                       |
| 类型   | 状态 · **概览**                            |
| 更新   | 2026-10-17（架构迁移开工，P2 挂起）        |
| 何时读 | **每次开工第一眼**，5 秒确认「现在做什么」 |
| 规模   | ~0.5k token                                |

> **本文件只写当前阶段的任务。** 任务完成 → 清空并重写；历史交给 git，长期排期见 `RM`。
> 任务跨多个模块时：**这里只给概览**，细节写在相关模块的 `status.md` 里，并从下表链过去。

## 当前任务

**架构迁移（`D8` / `GUI`）** ｜ 状态：🚧 **S0 旁路 spike 进行中**

一句话：把前端由 `@solidjs/router` + Nitro 换成 `@tanstack/solid-router` + `@tanstack/solid-start`，两个进程合并为**单 app**，Hono 降为 `/api/$` 子系统（oRPC 保留）；动机是拿到 loader / SSR 数据模型。

| 段  | 事项                                                                                                                    | 门槛                                                                               | 细节                  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------- |
| S0  | 一次性最小工程验 5 点（依赖可否装上 / Varlock SSR 注入 / Hono catch-all 挂载 / loader SSR 出数 / `@rsbuild/core` peer） | 全过才进 S1，任一不过退回 `D8`                                                     | `GUI` §7 · `S2` #4–#6 |
| S1  | 单 app 骨架：`apps/server/src/**` 并入 `apps/web/src/server/`、换 vite 插件、合并 `.env.schema`、端口收敛               | `bun run build` 能起，`/` 返回 SSR 页面                                            | `GUI` §2 · §5 · §6    |
| S2  | 路由与页面迁移（13 个路由文件 + `App.tsx`/`Document.tsx` 拆入 `__root.tsx` + 页面改 `loader`）                          | 每页 `check-types` + 手工打开                                                      | `GUI` §3              |
| S3  | Hono 挂载 + 内部路径重排（`/rpc`→`/api/rpc` 等 3 处 URL 变更）                                                          | `/api/reference` 能开，`/api/rpc` 能调通                                           | `GUI` §4              |
| S4  | 文档同批更新 + P2 全量回归                                                                                              | `check-types`/`lint`/`build` 全绿 + 上传/续传/刷新恢复/目录树/移动/删除/回收站全过 | `GUI` §7 S4           |

## 挂起（迁移期间停手）

**P2 收尾**：后端 + 前端主链路已落地（类型检查 / lint / build 全绿），⬜ 待人工联调，⬜ 回收站 / 收藏 / 移动 UI 未接线。迁移会重写 web 路由层，P2 未接线项**等 S4 之后再做**，避免白改。

## 阻塞

无 —— 两条前置已清（`D8` 已批准；工作区既有未提交改动已归集成一个 commit 并建迁移分支）。

## 上一阶段

- **P2 上传与文件管理（2026-10-16）**：`@MyDISK/storage` 本地驱动真 multipart + 路径穿越防护；`@MyDISK/db` `upload_session` 秒传 / `uploadedParts` 原子追加 / GC；`server` + `@MyDISK/api` 二进制面 `/api/upload/chunk`、`/api/raw/:nodeId`（签名令牌 + Range）与 4 个 router；`web` 文件管理器主页 + xstate 上传抽屉。详见 `A3` §5–§7、`A5`、`X1`、`D7`。
- **P0 地基 + P1 骨架可跑 完成（2026-09-14，commit `2b0eb1f`）**：db schema（19 表）与本地存储驱动落地；`@MyDISK/queue` 与 `@MyDISK/mail` 基础实现、`@MyDISK/cli` install 流程打通；`authRouter`/`systemRouter` + Better-Auth「禁注册 + founder」接入。

## 相关

- 里程碑与排期定义 → `RM` ｜ 未决问题 → `S2` ｜ 地图 → [`AGENTS.md`](AGENTS.md) §2
