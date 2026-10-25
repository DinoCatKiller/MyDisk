# worker · BullMQ 独立消费进程（P3）

|        |                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P3-1：进程骨架 + maintenance / mail 处理器；upload / archive / sync 随各自功能接入）                                         |
| 边界   | 消费队列、执行长任务（回收站清理 / 分片 GC / 发信 / 压缩 / 同步）；**不含**接口与入队（在 `@MyDISK/api`）、驱动（在 `@MyDISK/storage`） |
| 上游   | `@MyDISK/queue`、`@MyDISK/db`、`@MyDISK/storage`、`@MyDISK/mail`（依赖方向见 `A1` §2.2）                                                |
| 下游   | 无（独立进程）                                                                                                                          |
| 何时读 | 改队列处理器、加 worker 任务、调排期                                                                                                    |

## 这个 crate 是什么

后台**装卸工**：从 Redis（BullMQ）领任务并执行，与单 app 主进程解耦——回收站 30 天清理、暂存分片 GC、SMTP 发信都在这里跑。

## 核心内容

| 项                              | 说明                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                  | 入口：注册各队列 Worker（并发见 `A1` §4）、maintenance 每小时 repeatable（注册失败 10s 退避重试）、优雅启停 |
| `src/env.ts`                    | 环境变量：**与 web 单 app 共用 `apps/web/.env`**（单一事实来源），`process.env` 优先                        |
| `src/lib/driver.ts`             | 连接行 → 存储驱动（含云连接 `config_enc` 解密；与 `@MyDISK/api` 的 `driverFor` 同语义，因依赖方向自持一份） |
| `src/lib/purge.ts`              | 物理删除子树（与 `file.purge` 同语义：存储对象引用计数 → 断父子引用 → 删记录）                              |
| `src/processors/maintenance.ts` | 回收站清理（`trash_retention_days`）+ 悬挂分片会话 abort + 本地 `.tmp` 分片 GC（默认 24h）                  |
| `src/processors/mail.ts`        | 读启用中的 `smtp_setting`，解密口令后经 `@MyDISK/mail` 发信                                                 |

## 必须知道的两件事

1. **依赖方向**：worker 只依赖 `queue / db / storage / mail`（`A1` §2.2），因此不 import `@MyDISK/api`——`driverFor` 与 `purgeNodes` 各自持一份同语义实现；改动其一须同步另一处（评审点）。
2. **开发机 Redis 版本**：BullMQ 建议 ≥ 6.2，本机 dev 用 Redis 5.0.14（tporadowski Windows 构建）可用但会打版本警告；生产部署用 6.2+。

## 本地跑

```bash
redis-server --port 6379          # 先拉 Redis（本机 I:\redis\redis-server.exe）
bun run dev                       # turbo dev 会一并拉起 worker（--hot）
bun run start                     # 单独启动
```

## 相关

- 队列与并发定义 → `A1` §4 ｜ 队列常量与载荷 → `@MyDISK/queue` ｜ 存储契约 → `A4`
- 地图 → `AGENTS.md` §2
