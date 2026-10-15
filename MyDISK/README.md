# MyDisk（P-Storage）· 自托管私人云盘

> 人类入口，1 分钟读完。**文档地图在 [`AGENTS.md`](AGENTS.md) §2** —— 人和 agent 共用那一张表。

## 这是什么

单用户 / 小团队自托管的**私人云盘**：一个进程内可跑完的 Web 网盘 + 多存储后端统一网关 + 对外分享与 WebDAV 出口。

形态对标 AList / Cloudreve / `file.3rcd.com`：左侧目录树 + 右侧文件列表 + 顶部工具栏 + 底部上传队列（只借鉴交互与信息架构，不照搬实现）。

关键取舍：**单实例自托管**、**管理员单一角色体系**（无公开注册）、**控制面与数据面分离**（`D3`）、**完整输出 OpenAPI 3.1 而非引入 AI**（`D5`）。

## 现在到哪

状态**只在一处维护**，本文件不重复（重复必然腐烂）：

| 想知道                   | 去哪                                     |
| ------------------------ | ---------------------------------------- |
| 现在做什么、下一步       | [`STATUS.md`](STATUS.md)（一屏内）       |
| 等你拍板的事             | [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md) |
| 整体排期与「完成」的定义 | [`docs/roadmap.md`](docs/roadmap.md)     |

> 当前已交付 **P0 地基 + P1 骨架可跑**（见 `RM`）。前端页面多为占位骨架，文件管理 / 上传 / 分享等功能在 P2 起逐步落地。

## 文档放哪（约定）

**文档跟着代码走**（`D6`），不集中堆在一个 `docs/` 里：

| 位置                                           | 放什么                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| [`STATUS.md`](STATUS.md)（根）                 | 阶段**概览**：当前任务是什么、跨哪些模块。**只写当前任务，完成即重写**           |
| `<模块目录>/status.md`                         | 该模块在当前任务里的**细节**（按需建立，随任务生灭）                             |
| [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md)（根） | 未决问题，固定路径、就地更新                                                     |
| [`docs/roadmap.md`](docs/roadmap.md)           | 里程碑与排期定义（**不含状态**）                                                 |
| `packages/*/` · `apps/*/`                      | **机制与语义文档就放在对应模块旁**：`README.md`（门面）+ `docs/*.md`（规格细节） |
| `docs/*.md`（根）                              | 跨模块的规格：目标、架构、领域功能                                               |
| `docs/decisions/`                              | ADR，**只增不改**                                                                |
| `docs/plans/`                                  | 尚无归属模块的长期计划                                                           |
| `docs/research/`                               | 跨领域调研（一次性消费、会过时）                                                 |
| [`docs/_template.md`](docs/_template.md)       | 新文档模板                                                                       |

**引用规则**：文档之间只写 **ID**（如 `A1`、`S1`），**不写路径**。路径只在 [`AGENTS.md`](AGENTS.md) §2 的地图里出现一次 —— 这样搬文件不用改别的文档。

## 目录树

```
MyDISK/
├── README.md                人类入口（本文件）
├── AGENTS.md                agent 入口 + 唯一地图
├── STATUS.md                当前阶段与下一步（S1）
├── OPEN-QUESTIONS.md        未决问题（S2）
├── docs/
│   ├── _template.md         文档模板（T0）
│   ├── goals.md             目标、技术路线、自研边界（G1）
│   ├── architecture.md      架构与分层（A1）
│   ├── features.md          领域功能规格（A6，随 P2+ 落地）
│   ├── roadmap.md           里程碑与排期（RM）
│   ├── index/meta.md        文档规范与任务路由（M1）
│   └── decisions/           ADR（只增不改）
├── apps/
│   ├── web/                 SolidStart 前端（README + docs/ui.md = A5）
│   ├── server/              Hono + oRPC 装配（README）
│   └── worker/              BullMQ Worker（⬜ P3 新增）
└── packages/
    ├── api/                 oRPC 路由集合（README + docs/routers.md = A3）
    ├── auth/                Better-Auth 封装（README）
    ├── db/                  Drizzle schema（README + docs/schema.md = A2）
    ├── storage/             存储驱动抽象（README + docs/driver.md = A4）
    ├── queue/               BullMQ 队列（README）
    ├── mail/                SMTP 发信（README）
    ├── cli/                 安装与运维 CLI（README）
    └── config/              tsconfig 基线（README）
```

## 技术栈速览

Bun 1.3.14 · SolidJS 2 + Vite + Nitro（SSR）· Hono 4 · oRPC 1.15 · Zod 4 · Drizzle + PostgreSQL（库 `pstorage`）· Redis + BullMQ · Better-Auth。细节与版本基线见 `G1`、`D1`。

## 快速验证

```bash
bun install                 # 首次安装（Varlock 生成 env.ts）
bun run dev                 # 启动 web(:3001) + server(:3000)
bun run check               # Oxlint + Oxfmt
bun run check-types         # 全仓 TS 类型检查
bun run db:push             # 推送 schema 到数据库
bun run cli install         # 建表 + 创建 founder 管理员 + 生成 cli.sh / cli.ps1
```

前置服务：PostgreSQL（`pstorage`）与 Redis 需自行拉起（不使用 Docker，见 `G1`）。
