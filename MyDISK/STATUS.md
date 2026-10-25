# S1 · 当前阶段（概览）

|        |                                                                   |
| ------ | ----------------------------------------------------------------- |
| ID     | `S1`                                                              |
| 类型   | 状态 · **概览**                                                   |
| 更新   | 2026-10-26（P3 开工：worker + 云驱动已落地，MinIO/s3rver 验证过） |
| 何时读 | **每次开工第一眼**，5 秒确认「现在做什么」                        |
| 规模   | ~0.5k token                                                       |

> **本文件只写当前阶段的任务。** 任务完成 → 清空并重写；历史交给 git，长期排期见 `RM`。
> 任务跨多个模块时：**这里只给概览**，细节写在相关模块的 `status.md` 里，并从下表链过去。

## 当前任务

**P3 存储与分享（`RM`）** ｜ 状态：🚧 **P3-1/P3-2 完成，下一步连接管理与分享**

一句话：`apps/worker` 独立消费进程 + COS/OSS/S3 三云驱动落地（`A4` 契约 + `bun test` 契约测试）；继续把连接管理（`/settings/storage` + CRUD API）、分享、预览、压缩逐段交付。

| 步   | 事项                                                                                | 门槛                                                                        | 状态 |
| ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---- |
| P3-1 | `apps/worker`（maintenance 清理 / mail 发信；register 失败退避重试；优雅启停）      | worker 对真实 Redis 消费 + maintenance 正向清理验证（已过）                 | ✅   |
| P3-2 | 云驱动 S3 兼容 / COS / OSS（`A4`）；`driverFor` 解密 `config_enc`                   | `bun test`：本地回归 + S3 驱动对 s3rver 全链路（已过）；COS/OSS 仅 SDK 形状 | ✅   |
| P3-3 | 连接 CRUD API（建/改/删/测连通/设默认，密钥加密落库回掩码）+ `/settings/storage` 页 | UI 建 s3 连接 → 上传下载走通                                                | ⬜   |
| P3-4 | 分享：`/shares` 管理 + `/share/[token]` 公开页（密码/有效期/下载计数）              | 分享链路黑盒可演示                                                          | ⬜   |
| P3-5 | 预览全家桶（`preview/`，走 `/api/raw` 签名流）                                      | 图片/视频/PDF/Markdown/文本 + 回退                                          | ⬜   |
| P3-6 | 压缩解压（archive 队列 + worker 处理器）+ API 补 `copy` / `search`                  | 打包下载可演示                                                              | ⬜   |

## 刚完成：架构迁移（`D8` / `GUI`）+ P2 收尾（2026-10-25）

一句话：`@tanstack/solid-router` + `@tanstack/solid-start` 单 app 落地，Hono 降为 `/api/$` 子系统；`GUI` S0–S4 全过；P2 人工回归（上传 / 断点续传 / 刷新恢复 / 目录树与列表 / 移动 / 重命名 / 删除 / 回收站）黑盒全过；P2 收尾接线（回收站 / 收藏 / 移动 / 属性）已交付并验证；`check-types` / `lint` / `build` 全绿。

本阶段关键事实（细节见各模块文档）：

- **版本组合对齐**（修复迁移期遗留的响应性漂移）：`solid-js rc.18` + `@tanstack/solid-router|solid-start rc.9` + `@solidjs/vite-plugin next.51`；两条硬约束与强改密 gate 写法见 `A5` §1.1。
- **水合根因修复**：`AppShell` 曾在 `onSettled` 内调 `onCleanup`（Solid 2 禁止，dev 抛错炸掉全部受保护页水合，表现为「URL 变了内容不变」「按钮永不启用」）；改为返回清理函数。
- **暂停/恢复补洞**：`upload-chunk` 先接住客户端 abort（否则 ECONNRESET 打挂单 app 进程）；`RESUME_ALL` 逐个唤醒 paused 条目（`apps/web/README.md` 补充说明）。
- **P2 收尾**：`file.favorite/unfavorite/listFavorites` 三过程落 `@MyDISK/api`（`A3`）；`/trash`、`/favorites` 真页面 + 行内收藏/移动/属性（`A5`）。
- founder 密码已在回归中经 UI 改密流程更新（`must_change_password=false`）。

## 阶段内环境说明（P3）

- 开发机已就位：Redis 5.0.14（`I:
edis`，BullMQ 可用但建议生产 ≥ 6.2）、s3rver（`I:\s3rver`，:9000，S3 驱动验证服务器）。
- COS / OSS 驱动仅 SDK 形状验证（本机无真实云凭证）；接真实桶前先在 `P3-3` 的「测连通」里验证。
- worker 依赖方向自持 `driverFor` / `purgeNodes`（不 import `@MyDISK/api`），与 api 侧改动需同步（`apps/worker/README.md`）。

## 相关

- 里程碑与排期定义 → `RM` ｜ 未决问题 → `S2` ｜ 地图 → [`AGENTS.md`](AGENTS.md) §2
