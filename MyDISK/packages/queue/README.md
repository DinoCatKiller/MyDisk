# @MyDISK/queue · BullMQ 队列定义（骨架）

|        |                                                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P0 常量/载荷；**P3 起 `apps/worker` 消费**，maintenance / mail 已接入）                                                                    |
| 边界   | 负责队列名、Redis 连接、默认任务选项、任务载荷类型；**不含** worker 消费与任务执行逻辑（`apps/worker` P3，⬜）、不含队列的并发/调度规格（在 `A1` §4） |
| 上游   | `bullmq`、`ioredis`                                                                                                                                   |
| 下游   | `@MyDISK/api`（未来入队）、`apps/web`（`src/server` 装配）、`apps/worker`（消费）                                                                     |
| 何时读 | 加队列、worker 任务                                                                                                                                   |

## 这个 crate 是什么

流水线的**传送带**：只定义「有几条带子、带子叫什么、货物长什么样」，真正卸货的工位（worker）在 `apps/worker`——maintenance / mail 已消费，其余随功能接入。

## 核心内容

| 项                                | 说明                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `QUEUE_NAMES`                     | `upload`(合并/秒传/缩略图)、`archive`(压缩/解压/打包)、`sync`(连接间同步)、`mail`(发信)、`maintenance`(回收站清理/分片 GC/统计) |
| `createRedisConnection(redisUrl)` | 共享单例 `IORedis`，`maxRetriesPerRequest: null`、`enableReadyCheck: false`                                                     |
| `createQueue(name, redisUrl)`     | 用共享连接 + `DEFAULT_JOB_OPTIONS` 建 `Queue`                                                                                   |
| `DEFAULT_JOB_OPTIONS`             | `attempts: 3`、指数退避 `5000ms`、成功保留 1000 / 失败保留 5000                                                                 |
| 载荷类型                          | `MailJobData`、`ArchiveJobData`、`SyncJobData`、`UploadJobData`                                                                 |
| `closeRedisConnection()`          | 优雅关闭共享连接                                                                                                                |

## 必须知道的三个设计决定

1. **`maxRetriesPerRequest` 必须为 `null`**：BullMQ 的阻塞命令在 ioredis 默认重试下会直接抛错；且 queue 与 worker 必须复用同一份连接配置。
2. **Redis 连接走单例**：5 条队列若各开一条连接会白白多占连接，共享一条即可。
3. **队列名与并发映射写在 `A1` §4**：本包只落常量与载荷类型，不复制规格——规格改了改 `A1`，这里只跟着改常量。

## 相关

- `A1` §4（队列与任务模型）｜ `A6`（领域功能）｜ `S1`
- 地图 → `AGENTS.md` §2
