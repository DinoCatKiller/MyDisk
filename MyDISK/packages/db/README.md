# @MyDISK/db · Drizzle schema 与客户端，数据模型唯一事实源

|        |                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 状态   | ✅ 已落地（P0）                                                                                                                      |
| 边界   | 负责表结构 / 枚举 / 数据库客户端 / 迁移文件；**不含**业务查询编排（在 `@MyDISK/api`）、迁移执行入口（由 `cli` 的 `db:migrate` 调用） |
| 上游   | `drizzle-orm`、`pg`、varlock（生成 `env`）                                                                                           |
| 下游   | `auth`、`api`、`cli`、`server`                                                                                                       |
| 何时读 | 改表结构、迁移、连接                                                                                                                 |

## 这个 crate 是什么

整个系统的**地契**：所有持久化形状在这里定义一次，别处只引用。改表先改这里，再改契约（`A2`）。

## 核心内容

| 项                                               | 说明                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                   | `createDb(env)` = `drizzle(node-postgres) + schema`；`Database` 类型                                                    |
| `src/schema/index.ts`                            | 统一导出 `auth`/`enums`/`file`/`share`/`storage`/`sync`/`system`                                                        |
| `src/schema/auth.ts`                             | Better-Auth 原生表：`user`/`session`/`account`/`verification`                                                           |
| `src/schema/{file,storage,share,sync,system}.ts` | 业务表：`file_node`/`upload_session`/`storage_connection`/`share_link`/`sync_job`/`task`/`system_setting`/`favorite` 等 |
| `src/config.ts`                                  | `DatabaseConfig = { DATABASE_URL }`                                                                                     |
| `src/env.ts`                                     | varlock 生成的 `ENV`（`DATABASE_URL` / `NODE_ENV`）                                                                     |
| `drizzle.config.ts`                              | `schema=./src/schema`、`out=./src/migrations`、`dialect=postgresql`；脚本 `db:generate`/`migrate`/`push`/`studio`       |
| `src/migrations/`                                | 迁移基线 `0000_premium_proteus.sql` + `meta/`（journal 与快照）；**发布后只增不改**                                     |
| 导出子路径                                       | `.`、`./schema`、`./schema/*`（供按需精确 import）                                                                      |

## 必须知道的三个设计决定

1. **按域拆文件 + 暴露 `./schema/*` 子路径**：`auth` 包只 import `@MyDISK/db/schema/auth`，不让 `auth ↔ db` 出现循环依赖（依赖方向是 `auth → db`，单向）。
2. **导出工厂而非连接单例**：`createDb` 由调用方持有并复用连接（`server/services.ts` 里只建一次），避免多处 `drizzle()` 各开连接池。
3. **全局唯一性交给 DB 约束**：`founder` 唯一、默认连接唯一、本地连接唯一靠部分唯一索引，不靠应用层查重——并发下才可靠。

## 迁移工作流

1. **改表**：改 `src/schema/*` → `bun run db:generate` 生成新的 `src/migrations/NNNN_*.sql` + `meta/`，提交进仓库。
2. **应用**：`bun run db:migrate`（安装流程 `cli install` 同样调用它）按 journal 顺序执行未应用的迁移。
3. **旧库补基线**：历史库若是 `db:push` 建的表、迁移表为空，先 `bun run db:baseline` 写入 sha256 与时间戳，再执行 `db:migrate`；之后只跑新迁移。
4. **发布后只增不改**：已发布的迁移文件不得编辑或删除，改表一律新增迁移文件。
5. `db:push` 仅保留给开发期临时直推，不用于发布部署。

## 相关

- 数据模型（唯一事实源）→ 本模块 `docs/schema.md`（`A2`）｜ `A1` §3
- 地图 → `AGENTS.md` §2
