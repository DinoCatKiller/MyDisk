# @MyDISK/cli · 安装与运维命令行（`pstorage`）

|        |                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 状态   | ✅ 已落地（P0）                                                                                                                                        |
| 边界   | 负责 yargs 命令树、交互主菜单、`install` 流程、建号 / 改密 / 建表 / 起服务；**不依赖** `web`/`server`，**不含**运行时业务逻辑（那些在 `server`/`api`） |
| 上游   | `@MyDISK/auth`、`@MyDISK/db`、`@MyDISK/storage`；`yargs`、`@clack/prompts`                                                                             |
| 下游   | 运维人员（`./cli.sh`、`./cli.ps1`、`pstorage` bin）                                                                                                    |
| 何时读 | 加 CLI 子命令、改 install 流程                                                                                                                         |

## 这个 crate 是什么

系统的**总开关盒**：首次安装、建管理员、改密码、同步表结构、启动服务，都从这里按按钮。

## 核心内容

| 项                                        | 说明                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                            | yargs 入口（`scriptName: "pstorage"`）；无参时进入 `@clack/prompts` 主菜单                                                               |
| `src/commands/install.ts`                 | 安装：生成 `cli.sh`/`cli.ps1` → 依赖检查 → 连库自检 → `drizzle-kit push` → 建 founder → 默认 `local` 连接 → 写 `system_setting` + 装标记 |
| `src/commands/{passwd,admin,db,serve}.ts` | `passwd` / `admin:add\|list\|remove` / `db:push\|generate\|studio` / `serve`、`openapi`                                                  |
| `src/lib/bootstrap.ts`                    | `makeDb`/`makeAuth`/`createFounder`/`ensureLocalConnection`/`writeInitialSettings`/`checkDatabase`/`pushSchema`                          |
| `src/lib/cli-sh.ts`                       | 幂等生成项目根 `cli.sh`/`cli.ps1`（已存在则跳过）                                                                                        |
| `src/lib/env.ts`                          | `loadCliEnv`：读 `apps/server/.env` 且真实环境变量可覆盖；`maskDatabaseUrl` 打印脱敏                                                     |
| `src/lib/prompts.ts`                      | `DEFAULT_FOUNDER`、`askText`/`askPassword`/`askConfirm`、`pickMainMenuAction`                                                            |

## 必须知道的三个设计决定

1. **建号走允许注册的 auth 实例**：`createFounder`/`createAdmin` 用 `allowSignUp:true` 的实例 `signUpEmail` 建号，保证密码哈希与 Better-Auth 完全一致；系统运行态仍禁注册（`D4`）。
2. **`cli.sh` 幂等且能自举**：未检测到安装标记时自动 `bun install` 再进 `install`，把首次部署压成一条命令；Windows 同步生成 `cli.ps1`。
3. **env 单一来源**：CLI 读 `apps/server/.env` 并允许真实环境变量覆盖，避免 CLI 与 server 各读一份配置造成分叉。

## 相关

- `A1` §5（CLI 与安装流程）｜ `D4`｜ `A2` §15（迁移与初始化）
- 地图 → `AGENTS.md` §2
