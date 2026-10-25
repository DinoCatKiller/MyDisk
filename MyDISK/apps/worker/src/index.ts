import { Worker, type Job } from "bullmq";

import {
  closeRedisConnection,
  createRedisConnection,
  QUEUE_NAMES,
  type QueueName,
} from "@MyDISK/queue";

import { loadWorkerEnv } from "./env";
import { runMail } from "./processors/mail";
import { runMaintenance } from "./processors/maintenance";

const env = loadWorkerEnv();

/** 各队列的并发数（`A1` §4） */
const CONCURRENCY: Record<Exclude<QueueName, never>, number> = {
  upload: 4,
  archive: 2,
  sync: 2,
  mail: 8,
  maintenance: 1,
};

type Processor = (job: Job) => Promise<unknown>;

const processors: Partial<Record<QueueName, Processor>> = {
  maintenance: async () => runMaintenance(env),
  mail: async (job) =>
    runMail(env, job.data as { to: string; subject: string; html: string; text?: string }),
  // upload（合并/秒传）在 P2 走内联同步路径；archive / sync 的处理器随 P3 各功能落地
};

const workers: Worker[] = [];

async function start(): Promise<void> {
  createRedisConnection(env.REDIS_URL);
  console.log(`[worker] redis -> ${env.REDIS_URL}`);

  for (const name of Object.values(QUEUE_NAMES) as QueueName[]) {
    const processor = processors[name];
    if (!processor) {
      console.log(`[worker] ${name}: 暂无处理器，跳过（功能落地时接入）`);
      continue;
    }
    const worker = new Worker(name, processor, {
      connection: createRedisConnection(env.REDIS_URL),
      concurrency: CONCURRENCY[name],
    });
    worker.on("failed", (job, error) => {
      console.error(`[worker] ${name} job#${job?.id ?? "?"} 失败: ${error.message}`);
    });
    workers.push(worker);
    console.log(`[worker] ${name}: 消费中（并发 ${CONCURRENCY[name]}）`);
  }

  // maintenance 注册为每小时 repeatable（幂等：同 jobId 不会重复创建）。
  // Redis 暂不可用（如本机未启动）不阻塞 dev：注册失败后退避重试。
  const schedule = (): Promise<void> => scheduleMaintenanceRepeatable();
  const scheduleWithRetry = (): void => {
    schedule().catch((error) => {
      console.warn(`[worker] repeatable 注册失败（10s 后重试）: ${error.message}`);
      setTimeout(() => scheduleWithRetry(), 10_000);
    });
  };
  scheduleWithRetry();

  console.log("[worker] 启动完成");
}

async function scheduleMaintenanceRepeatable(): Promise<void> {
  const { Queue } = await import("bullmq");
  const queue = new Queue(QUEUE_NAMES.maintenance, {
    connection: createRedisConnection(env.REDIS_URL),
  });
  await queue.add(
    "maintenance-tick",
    {},
    {
      jobId: "maintenance-tick",
      repeat: { pattern: "0 * * * *" }, // 每小时整点
      removeOnComplete: { count: 50 },
    },
  );
  await queue.close();
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] 收到 ${signal}，优雅关闭…`);
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await closeRedisConnection();
  console.log("[worker] 已退出");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void start().catch((error) => {
  console.error("[worker] 启动失败:", error);
  process.exit(1);
});
