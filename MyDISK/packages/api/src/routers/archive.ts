import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import type { Database } from "@MyDISK/db";
import { fileNode, task, type TaskRow } from "@MyDISK/db/schema";

import { protectedProcedure } from "../procedure";
import { cancelArchiveJob, enqueueArchiveJob } from "../lib/archive-queue";
import { buildTaskRawUrl, signTaskRawToken } from "../lib/raw-token";
import { okSchema } from "../schemas/common";
import {
  archiveCompressInput,
  archiveExtractInput,
  archivePackageInput,
  archiveTaskOutput,
  taskIdInput,
  taskListInput,
  taskListSchema,
  taskViewSchema,
  type TaskView,
} from "../schemas/task";

const ARCHIVE_EXTENSIONS = [".zip", ".tar.gz", ".tgz", ".tar"];

function toTaskView(row: TaskRow, signingSecret: string): TaskView {
  let downloadUrl: string | null = null;
  if (
    row.type === "package_download" &&
    row.status === "completed" &&
    typeof row.result?.storageKey === "string"
  ) {
    downloadUrl = buildTaskRawUrl(row.id, signTaskRawToken(row.id, signingSecret));
  }
  return taskViewSchema.parse({ ...row, downloadUrl });
}

async function requireNodes(db: Database, nodeIds: string[]) {
  const rows = await db
    .select()
    .from(fileNode)
    .where(and(inArray(fileNode.id, nodeIds), isNull(fileNode.deletedAt)));
  if (rows.length !== nodeIds.length) {
    throw new ORPCError("NOT_FOUND", { message: "文件不存在或已删除" });
  }
  const connectionId = rows[0]?.connectionId;
  if (!connectionId || rows.some((row) => row.connectionId !== connectionId)) {
    throw new ORPCError("BAD_REQUEST", { message: "压缩/打包仅支持同一存储连接内的节点" });
  }
  return rows;
}

/** 目标目录校验：null = 连接根；必须同连接且未删除 */
async function requireFolder(
  db: Database,
  connectionId: string,
  parentId: string | null,
): Promise<string | null> {
  if (!parentId) {
    return null;
  }
  const rows = await db
    .select({ id: fileNode.id, type: fileNode.type })
    .from(fileNode)
    .where(
      and(
        eq(fileNode.id, parentId),
        eq(fileNode.connectionId, connectionId),
        isNull(fileNode.deletedAt),
      ),
    )
    .limit(1);
  const folder = rows[0];
  if (!folder || folder.type !== "folder") {
    throw new ORPCError("NOT_FOUND", { message: "目标目录不存在" });
  }
  return folder.id;
}

function stampName(): string {
  const now = new Date();
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function zipNameOf(nodes: { name: string }[], explicit?: string): string {
  const base = explicit ?? (nodes.length === 1 ? nodes[0]!.name : `archive-${stampName()}`);
  return base.toLowerCase().endsWith(".zip") ? base : `${base}.zip`;
}

function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 创建 task 记录并入队；入队失败时把任务标记为 failed，避免前端永远等 pending */
async function createArchiveTask(
  context: {
    db: Database;
    redisUrl: string;
    user: { id: string };
  },
  data: {
    type: "compress" | "extract" | "package_download";
    title: string;
    nodeIds: string[];
    targetParentId?: string | null;
    name?: string;
  },
) {
  const [created] = await context.db
    .insert(task)
    .values({
      type: data.type,
      status: "pending",
      title: data.title,
      payload: {
        nodeIds: data.nodeIds,
        targetParentId: data.targetParentId ?? null,
        name: data.name ?? null,
      },
      userId: context.user.id,
    })
    .returning();
  if (!created) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "创建任务失败" });
  }

  try {
    await enqueueArchiveJob(context.redisUrl, {
      taskId: created.id,
      type: data.type,
      nodeIds: data.nodeIds,
      targetParentId: data.targetParentId ?? null,
      name: data.name,
      userId: context.user.id,
    });
  } catch {
    await context.db
      .update(task)
      .set({
        status: "failed",
        error: "任务队列不可用（请确认 Redis 已启动）",
        finishedAt: new Date(),
      })
      .where(eq(task.id, created.id));
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "任务队列不可用，请确认 Redis 已启动后再试",
    });
  }

  return created;
}

/* ------------------------------------------------------------------ */
/* task（通用任务查询 / 取消）                                          */
/* ------------------------------------------------------------------ */

const list = protectedProcedure
  .route({ method: "GET", path: "/tasks", summary: "任务列表", tags: ["task"] })
  .input(taskListInput)
  .output(taskListSchema)
  .handler(async ({ input, context }) => {
    const isFounder = context.user.role === "founder";
    const where = and(
      isFounder ? undefined : eq(task.userId, context.user.id),
      input.type ? eq(task.type, input.type) : undefined,
      input.status ? eq(task.status, input.status) : undefined,
    );
    const [totalRow] = await context.db.select({ value: count() }).from(task).where(where);
    const rows = await context.db
      .select()
      .from(task)
      .where(where)
      .orderBy(desc(task.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return {
      items: rows.map((row) => toTaskView(row, context.signingSecret)),
      total: totalRow?.value ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  });

const get = protectedProcedure
  .route({ method: "GET", path: "/tasks/{id}", summary: "任务详情", tags: ["task"] })
  .input(taskIdInput)
  .output(taskViewSchema)
  .handler(async ({ input, context }) => {
    const rows = await context.db.select().from(task).where(eq(task.id, input.id)).limit(1);
    const row = rows[0];
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "任务不存在" });
    }
    if (row.userId !== context.user.id && context.user.role !== "founder") {
      throw new ORPCError("FORBIDDEN", { message: "无权查看该任务" });
    }
    return toTaskView(row, context.signingSecret);
  });

const cancel = protectedProcedure
  .route({ method: "POST", path: "/tasks/{id}/cancel", summary: "取消任务", tags: ["task"] })
  .input(taskIdInput)
  .output(okSchema)
  .handler(async ({ input, context }) => {
    const rows = await context.db.select().from(task).where(eq(task.id, input.id)).limit(1);
    const row = rows[0];
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "任务不存在" });
    }
    if (row.userId !== context.user.id && context.user.role !== "founder") {
      throw new ORPCError("FORBIDDEN", { message: "无权取消该任务" });
    }
    if (row.status !== "pending" && row.status !== "running") {
      return { ok: true };
    }
    await context.db
      .update(task)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(task.id, row.id));
    await cancelArchiveJob(context.redisUrl, row.id);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* archive（压缩 / 解压 / 打包下载）                                    */
/* ------------------------------------------------------------------ */

const compress = protectedProcedure
  .route({
    method: "POST",
    path: "/archives/compress",
    summary: "压缩为 zip（队列任务）",
    tags: ["archive"],
  })
  .input(archiveCompressInput)
  .output(archiveTaskOutput)
  .handler(async ({ input, context }) => {
    const nodes = await requireNodes(context.db, input.nodeIds);
    const connectionId = nodes[0]!.connectionId;
    const targetParentId =
      input.targetParentId !== undefined ? input.targetParentId : nodes[0]!.parentId;
    await requireFolder(context.db, connectionId, targetParentId ?? null);

    const name = zipNameOf(nodes, input.name);
    const created = await createArchiveTask(context, {
      type: "compress",
      title: `压缩 ${name}`,
      nodeIds: nodes.map((node) => node.id),
      targetParentId: targetParentId ?? null,
      name,
    });
    return { task: toTaskView(created, context.signingSecret) };
  });

const extract = protectedProcedure
  .route({
    method: "POST",
    path: "/archives/extract",
    summary: "解压 zip / tar.gz（队列任务）",
    tags: ["archive"],
  })
  .input(archiveExtractInput)
  .output(archiveTaskOutput)
  .handler(async ({ input, context }) => {
    const [node] = await requireNodes(context.db, [input.nodeId]);
    if (!node || node.type !== "file") {
      throw new ORPCError("BAD_REQUEST", { message: "仅文件支持解压" });
    }
    if (!isArchiveName(node.name)) {
      throw new ORPCError("BAD_REQUEST", { message: "仅支持 zip / tar / tar.gz 压缩包" });
    }
    const targetParentId =
      input.targetParentId !== undefined ? input.targetParentId : node.parentId;
    await requireFolder(context.db, node.connectionId, targetParentId ?? null);

    const created = await createArchiveTask(context, {
      type: "extract",
      title: `解压 ${node.name}`,
      nodeIds: [node.id],
      targetParentId: targetParentId ?? null,
      name: node.name,
    });
    return { task: toTaskView(created, context.signingSecret) };
  });

const packageDownload = protectedProcedure
  .route({
    method: "POST",
    path: "/archives/package",
    summary: "打包下载（临时 zip，不落文件树）",
    tags: ["archive"],
  })
  .input(archivePackageInput)
  .output(archiveTaskOutput)
  .handler(async ({ input, context }) => {
    const nodes = await requireNodes(context.db, input.nodeIds);
    const name = zipNameOf(nodes);
    const created = await createArchiveTask(context, {
      type: "package_download",
      title: `打包下载 ${name}`,
      nodeIds: nodes.map((node) => node.id),
      name,
    });
    return { task: toTaskView(created, context.signingSecret) };
  });

export const taskRouter = { list, get, cancel };

export const archiveRouter = {
  compress,
  extract,
  package: packageDownload,
};
