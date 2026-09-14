import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

/** 队列名称常量 */
export const QUEUE_NAMES = {
  /** 分片合并、秒传校验、缩略图 */
  upload: "upload",
  /** 压缩 / 解压 / 打包下载 */
  archive: "archive",
  /** 连接间同步 */
  sync: "sync",
  /** 发信 */
  mail: "mail",
  /** 回收站清理、临时分片 GC、统计 */
  maintenance: "maintenance",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 5_000 },
};

let sharedConnection: IORedis | null = null;

/**
 * BullMQ 要求 worker 与 queue 复用同一连接配置。
 * maxRetriesPerRequest 必须为 null，否则阻塞命令会抛错。
 */
export function createRedisConnection(redisUrl: string): IORedis {
  if (!sharedConnection) {
    sharedConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return sharedConnection;
}

export async function closeRedisConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
  }
}

export function createQueue(name: QueueName, redisUrl: string): Queue {
  return new Queue(name, {
    connection: createRedisConnection(redisUrl),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export type MailJobData = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type ArchiveJobData = {
  taskId: string;
  type: "compress" | "extract" | "package_download";
  nodeIds: string[];
  targetParentId?: string | null;
  userId: string;
};

export type SyncJobData = {
  jobId: string;
  fromConnectionId: string;
  toConnectionId: string;
  conflictStrategy: "keep_both" | "overwrite" | "skip";
};

export type UploadJobData = {
  uploadId: string;
  userId: string;
};
