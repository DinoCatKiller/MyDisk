import { createQueue, QUEUE_NAMES, type ArchiveJobData } from "@MyDISK/queue";

/**
 * archive 队列的入队单例。
 * BullMQ 的 Queue 持有长连接，按 Redis URL 缓存一份，避免每个请求新建。
 */
let queue: ReturnType<typeof createQueue> | null = null;
let queueUrl = "";

function getQueue(redisUrl: string) {
  if (!queue || queueUrl !== redisUrl) {
    queue = createQueue(QUEUE_NAMES.archive, redisUrl);
    queueUrl = redisUrl;
  }
  return queue;
}

/** 任务 id 同时作为 BullMQ jobId（`A2` §9），保证取消/去重可按 id 定位 */
export async function enqueueArchiveJob(redisUrl: string, data: ArchiveJobData): Promise<void> {
  await getQueue(redisUrl).add("archive", data, { jobId: data.taskId });
}

/** 取消排队中的任务；已开始执行的任务由 worker 读取 task.status 自行收尾 */
export async function cancelArchiveJob(redisUrl: string, taskId: string): Promise<void> {
  try {
    const job = await getQueue(redisUrl).getJob(taskId);
    if (job) {
      await job.remove();
    }
  } catch {
    // Redis 不可用或任务已被消费时不阻塞取消
  }
}
