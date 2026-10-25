# S1 · 当前阶段（概览）

|        |                                                             |
| ------ | ----------------------------------------------------------- |
| ID     | `S1`                                                        |
| 类型   | 状态 · **概览**                                             |
| 更新   | 2026-10-25（架构迁移 + P2 收尾完成，回归全过，已并回 main） |
| 何时读 | **每次开工第一眼**，5 秒确认「现在做什么」                  |
| 规模   | ~0.5k token                                                 |

> **本文件只写当前阶段的任务。** 任务完成 → 清空并重写；历史交给 git，长期排期见 `RM`。
> 任务跨多个模块时：**这里只给概览**，细节写在相关模块的 `status.md` 里，并从下表链过去。

## 当前任务

（无进行中任务）

## 刚完成：架构迁移（`D8` / `GUI`）+ P2 收尾（2026-10-25）

一句话：`@tanstack/solid-router` + `@tanstack/solid-start` 单 app 落地，Hono 降为 `/api/$` 子系统；`GUI` S0–S4 全过；P2 人工回归（上传 / 断点续传 / 刷新恢复 / 目录树与列表 / 移动 / 重命名 / 删除 / 回收站）黑盒全过；P2 收尾接线（回收站 / 收藏 / 移动 / 属性）已交付并验证；`check-types` / `lint` / `build` 全绿。

本阶段关键事实（细节见各模块文档）：

- **版本组合对齐**（修复迁移期遗留的响应性漂移）：`solid-js rc.18` + `@tanstack/solid-router|solid-start rc.9` + `@solidjs/vite-plugin next.51`；两条硬约束与强改密 gate 写法见 `A5` §1.1。
- **水合根因修复**：`AppShell` 曾在 `onSettled` 内调 `onCleanup`（Solid 2 禁止，dev 抛错炸掉全部受保护页水合，表现为「URL 变了内容不变」「按钮永不启用」）；改为返回清理函数。
- **暂停/恢复补洞**：`upload-chunk` 先接住客户端 abort（否则 ECONNRESET 打挂单 app 进程）；`RESUME_ALL` 逐个唤醒 paused 条目（`apps/web/README.md` 补充说明）。
- **P2 收尾**：`file.favorite/unfavorite/listFavorites` 三过程落 `@MyDISK/api`（`A3`）；`/trash`、`/favorites` 真页面 + 行内收藏/移动/属性（`A5`）。
- founder 密码已在回归中经 UI 改密流程更新（`must_change_password=false`）。

## 下一阶段

**P3（见 `RM`）**：`apps/worker` 独立进程、分享（`/shares` + `/share/[token]`）、存储连接管理（`/settings/storage`）、`copy` / `search` 等过程。开工前按 `AGENTS.md` §0 协议读图。

## 相关

- 里程碑与排期定义 → `RM` ｜ 未决问题 → `S2` ｜ 地图 → [`AGENTS.md`](AGENTS.md) §2
