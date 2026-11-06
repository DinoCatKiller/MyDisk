import * as z from "zod";

import { taskStatusEnum, taskTypeEnum } from "@MyDISK/db/schema";

import { pageSchema, paginationSchema } from "./common";

export const taskViewSchema = z.object({
  id: z.uuid(),
  type: z.enum(taskTypeEnum.enumValues),
  status: z.enum(taskStatusEnum.enumValues),
  progress: z.number().int(),
  title: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  /** `package_download` 完成后的签名下载地址；其余类型为 null */
  downloadUrl: z.string().nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TaskView = z.infer<typeof taskViewSchema>;

export const taskListInput = paginationSchema.extend({
  type: z.enum(taskTypeEnum.enumValues).optional(),
  status: z.enum(taskStatusEnum.enumValues).optional(),
});

export const taskListSchema = pageSchema(taskViewSchema);

export const taskIdInput = z.object({ id: z.uuid() });

export const archiveCompressInput = z.object({
  nodeIds: z.array(z.uuid()).min(1),
  targetParentId: z.uuid().nullish(),
  name: z.string().trim().min(1).max(255).optional(),
});

export const archiveExtractInput = z.object({
  nodeId: z.uuid(),
  targetParentId: z.uuid().nullish(),
});

export const archivePackageInput = z.object({
  nodeIds: z.array(z.uuid()).min(1),
});

export const archiveTaskOutput = z.object({ task: taskViewSchema });
