# AGENTS.md — agent 入口 · 唯一地图

> 常驻上下文，必须精简。这里只有：读取协议、地图、硬约束；§1 / §3 已外移，仅留指针 → `M1`。
> **引用文档只写 ID（如 `A1`），不写路径** —— 路径只出现在 §2 这张表里。搬文件不用改其它文档。

## 0. 读取协议

1. 读本文件 → 在 §2 地图里定位与任务相关的条目（相关 1 条就读 1 条，相关 6 条就读 6 条，**不设数量上限**）。
2. 只读这些条目指向的文档。模块的 `README.md` 是它的门面，**先读 README 再进它的 `docs/`**；单篇先看 `TL;DR`，需要细节再往下读。
3. **按需读取，宁多勿错**。唯一判断标准：**「读它能改变我的做法、或让我少犯错吗？」** 能 → 读；不能 → 不读。
   读得多是因为**相关**，不是因为"额度还剩"。
   - **明确不读**（除非任务就是它们）：`X*` 调研（一次性消费、会过时）；`D*` ADR 中与本任务无关的部分；`⬜` 条目（文件不存在）；与本任务无关模块的 `docs/`。
4. `⬜` = 文件不存在。复制 [`docs/_template.md`](docs/_template.md) 建骨架，写完回填本表状态。**不预建空文件。**
5. **状态就地更新，从不搬家**：
   - 根 [`STATUS.md`](STATUS.md)（`S1`）= **概览**：当前阶段做什么、横跨哪些模块。**一屏内，只写当前任务。**
   - `<模块目录>/status.md` = **细节**：某模块在本任务里要做什么。按需建立、随任务生灭。
   - **任务完成 → 清空或重写**，不留历史（历史交给 git）。长期排期写 `RM`，**永远不写进 status**。
   - 未决问题在根 [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md)（`S2`）。

## 1. 文档归属规则（按需读）

全文见 `M1`。只在**新建 / 搬移文档**时读。

## 2. 地图

规模为估算 token（≈KB × 350，中文），用于判断读取成本。
路径列中**已存在**的文档给可点击链接；状态 `⬜`（待建）的保持纯文本，避免死链。

**ID 前缀含义**（看 ID 就知道它大概是什么、属于谁）：

| 前缀        | 含义                                | 前缀           | 含义                       |
| ----------- | ----------------------------------- | -------------- | -------------------------- |
| `S1` / `S2` | 状态概览 / 未决问题                 | `P1–Pn` / `PT` | 供应商/插件文档 / 其模板   |
| `G1`        | 目标与技术路线                      | `X1–Xn`        | 调研（一次性消费，会过时） |
| `A1–An`     | 架构与契约（跨模块或归属某模块）    | `D0–Dn`        | 决策 ADR（**只增不改**）   |
| `R1–Rn`     | 运行时（配置 / 路由 / 观测 / 限流） | `RM`           | 里程碑排期（**不含状态**） |
| `Q1–Qn`     | 质量（测试 / 评测 / 安全）          | `GUI`          | 某期计划                   |
| `M1`        | 文档规范（归属 + 路由）             | `T0`           | 文档模板                   |

### 状态与排期

| ID  | 标题                             | 路径                                     | 何时读                   | 规模  | 状态 |
| --- | -------------------------------- | ---------------------------------------- | ------------------------ | ----- | ---- |
| S1  | 当前阶段**概览**（只写当前任务） | [`STATUS.md`](STATUS.md)                 | **每次开工第一眼**       | ~0.5k | ✅   |
| S2  | 未决问题（全项目唯一来源）       | [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md) | 需要拍板时               | ~1k   | ✅   |
| RM  | 里程碑与排期定义（**不含状态**） | [`docs/roadmap.md`](docs/roadmap.md)     | 想知道整体排期与完成标准 | ~0.9k | ✅   |

### 跨模块规格与契约（根 `docs/` 与模块 `docs/`）

| ID  | 标题                                                             | 路径                                                                 | 何时读                                | 规模  | 状态 |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- | ----- | ---- |
| G1  | 目标、技术路线、自研边界                                         | [`docs/goals.md`](docs/goals.md)                                     | 争论「要不要自研 / 先做哪个」         | ~2k   | ✅   |
| A1  | 架构与分层（拓扑 / 目录 / 队列 / CLI / 环境 / 安全）             | [`docs/architecture.md`](docs/architecture.md)                       | 新建模块、改目录结构、改部署          | ~4k   | ✅   |
| A2  | 数据模型（Drizzle schema，19 张表）                              | [`packages/db/docs/schema.md`](packages/db/docs/schema.md)           | 改表、加字段、写查询前                | ~5k   | ✅   |
| A3  | oRPC 接口契约（router 清单 + REST 语义）                         | [`packages/api/docs/routers.md`](packages/api/docs/routers.md)       | 加/改接口、对齐前端调用               | ~4k   | ✅   |
| A4  | 存储抽象契约（StorageDriver / 分片 / 密钥加密）                  | [`packages/storage/docs/driver.md`](packages/storage/docs/driver.md) | 加存储驱动、改上传取流时              | ~2k   | ✅   |
| A5  | 前端信息架构与视觉规范                                           | [`apps/web/docs/ui.md`](apps/web/docs/ui.md)                         | 加页面、改布局/样式前                 | ~2.5k | ✅   |
| A6  | 领域功能规格（上传 / 文件 / 分享 / 同步 / 压缩 / 预览 / WebDAV） | [`docs/features.md`](docs/features.md)                               | 实现 P2+ 任一功能前                   | ~4k   | ✅   |
| M1  | 文档规范（归属判定 + 任务路由全文）                              | [`docs/index/meta.md`](docs/index/meta.md)                           | 新建 / 搬移文档、开新任务不确定读哪些 | ~1.5k | ✅   |
| T0  | 文档模板（含写作规则注释块）                                     | [`docs/_template.md`](docs/_template.md)                             | 新建任何文档                          | ~0.3k | ✅   |

### 各模块门面（先读 README 再进它的 `docs/`）

| ID  | 标题                                          | 路径                                                       | 何时读                          | 规模  | 状态 |
| --- | --------------------------------------------- | ---------------------------------------------------------- | ------------------------------- | ----- | ---- |
| —   | `web` 门面：TanStack Start 单 app（页面路由 + Hono `/api` 子系统装配） | [`apps/web/README.md`](apps/web/README.md)                 | 改前端页面 / 组件 / 样式、改 API 装配与二进制面 | ~1.2k | ✅   |
| —   | `@MyDISK/api` 门面：oRPC 路由集合             | [`packages/api/README.md`](packages/api/README.md)         | 加接口、改权限中间件            | ~0.9k | ✅   |
| —   | `@MyDISK/auth` 门面：Better-Auth 封装         | [`packages/auth/README.md`](packages/auth/README.md)       | 改登录 / 会话 / 管理员体系      | ~0.9k | ✅   |
| —   | `@MyDISK/db` 门面：Drizzle schema 与客户端    | [`packages/db/README.md`](packages/db/README.md)           | 改表结构、迁移、连接            | ~0.9k | ✅   |
| —   | `@MyDISK/storage` 门面：存储驱动抽象          | [`packages/storage/README.md`](packages/storage/README.md) | 加驱动、改物理键 / 加密         | ~0.9k | ✅   |
| —   | `@MyDISK/queue` 门面：BullMQ 队列             | [`packages/queue/README.md`](packages/queue/README.md)     | 加队列 / worker 任务            | ~0.7k | ✅   |
| —   | `@MyDISK/mail` 门面：SMTP 发信                | [`packages/mail/README.md`](packages/mail/README.md)       | 改邮件模板 / 发信流程           | ~0.7k | ✅   |
| —   | `@MyDISK/cli` 门面：安装与运维命令            | [`packages/cli/README.md`](packages/cli/README.md)         | 加 CLI 子命令、改 install 流程  | ~0.9k | ✅   |
| —   | `@MyDISK/config` 门面：tsconfig 基线          | [`packages/config/README.md`](packages/config/README.md)   | 改 TS 编译选项                  | ~0.4k | ✅   |

### 决策记录（只增不改）

| ID  | 标题                                                           | 路径                                                                                                       | 何时读                                   | 规模  | 状态 |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----- | ---- |
| D0  | ADR 模板                                                       | [`docs/decisions/_template.md`](docs/decisions/_template.md)                                               | 写新 ADR                                 | ~0.2k | ✅   |
| D1  | 技术栈定稿（Bun / Hono / oRPC / PostgreSQL / Redis / Drizzle） | [`docs/decisions/0001-tech-stack.md`](docs/decisions/0001-tech-stack.md)                                   | 想质疑或更换技术栈时                     | ~0.7k | ✅   |
| D2  | 前端 SolidJS 2 + Tailwind v4 自研组件（弃 HeroUI）             | [`docs/decisions/0002-frontend-solidjs-custom-ui.md`](docs/decisions/0002-frontend-solidjs-custom-ui.md)   | 想换前端框架 / UI 库时                   | ~0.6k | ✅   |
| D3  | 双协议面分离：oRPC 控制面 + 原生 HTTP 数据面                   | [`docs/decisions/0003-dual-protocol-split.md`](docs/decisions/0003-dual-protocol-split.md)                 | 改动上传 / 下载 / 取流接口时             | ~0.6k | ✅   |
| D4  | 单管理员体系与 founder 唯一（禁公开注册）                      | [`docs/decisions/0004-single-admin-founder.md`](docs/decisions/0004-single-admin-founder.md)               | 改认证 / 管理员 / 注册流程时             | ~0.6k | ✅   |
| D5  | 输出 OpenAPI 3.1 而非引入 AI 能力                              | [`docs/decisions/0005-openapi-not-ai.md`](docs/decisions/0005-openapi-not-ai.md)                           | 想加"AI 接口"或改接口文档时              | ~0.5k | ✅   |
| D6  | 文档跟代码走（本体系）                                         | [`docs/decisions/0006-docs-follow-code.md`](docs/decisions/0006-docs-follow-code.md)                       | 想改文档组织方式时                       | ~0.6k | ✅   |
| D7  | 上传编排采用 xstate 核心 + 模块级 actor 池                     | [`docs/decisions/0007-xstate-upload-orchestration.md`](docs/decisions/0007-xstate-upload-orchestration.md) | 想质疑或推翻上传前端编排方式时           | ~0.6k | ✅   |
| D8  | 前端迁 TanStack Start：单 app + Hono `/api` 子系统             | [`docs/decisions/0008-tanstack-start-single-app.md`](docs/decisions/0008-tanstack-start-single-app.md)     | 想质疑前端路由 / SSR 载体、单 app 拓扑时 | ~1.3k | ✅   |

### 计划与调研

| ID  | 标题                                                      | 路径                                                                           | 何时读                             | 规模  | 状态 |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- | ----- | ---- |
| X1  | P2 上传前端方案调研（状态机绑定 · 刷新续传载体 · 状态图） | [`docs/research/p2-upload-frontend.md`](docs/research/p2-upload-frontend.md)   | P2 实现上传与文件管理（前端）前    | ~0.9k | ✅   |
| GUI | 架构迁移计划（Start 单 app + Hono `/api` 子系统，进行中） | [`docs/plans/architecture-migration.md`](docs/plans/architecture-migration.md) | 执行迁移前；想知道改动面与验证门槛 | ~2.5k | ✅   |

## 3. 任务路由（按需读）

全文见 `M1`。只在**开新任务、不确定该读哪些文档**时读。

## 4. 硬约束（始终生效）

1. **技术栈已定**（见 `D1`/`D2`/`D8`）：Bun 1.3.14 · SolidJS 2 + Vite + **TanStack Start**（`D8` 已落地：单 app 单端口，Hono 降为 `/api` 子系统；取代 `D2` 的 Nitro 载体）· Hono 4 · oRPC 1.15 · Drizzle + PostgreSQL `pstorage` · Redis + BullMQ · Better-Auth。任何替代方案的引入需先写 ADR。
2. **依赖方向单向**：`apps/* → packages/* → packages/config`，只能向下，禁止反向（`packages/*` 不得 import `apps/*`）。
3. **二进制面不走 oRPC**（`D3`）：分片上传 / 流式下载 / 预览取流走 Hono 原生路由，带签名令牌鉴权。
4. **一个结论只有一个家**：其它文档只许用 ID 引用，不许复制内容。
5. 未决问题只写在 `S2`；ADR **只增不改**。
6. **密钥 / 真实 AK·SK 不入库、不出接口**：落库前 AES-256-GCM 加密，列表只回掩码（见 `A4`）。
7. **文档跟代码走**：改某模块行为，同批次更新它的 `README.md` / `docs/`，并回填 §2 地图状态。
