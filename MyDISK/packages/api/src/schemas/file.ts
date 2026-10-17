import * as z from "zod";

import { nodeStatusEnum, nodeTypeEnum } from "@MyDISK/db/schema";

import { pageSchema, paginationSchema, sortSchema } from "./common";

export const fileNodeMetaSchema = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  pages: z.number().optional(),
  thumbKey: z.string().optional(),
  previewCache: z.string().optional(),
});

export const fileNodeSchema = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  parentId: z.uuid().nullable(),
  ownerId: z.string(),
  type: z.enum(nodeTypeEnum.enumValues),
  name: z.string(),
  storageKey: z.string(),
  mime: z.string().nullable(),
  ext: z.string().nullable(),
  size: z.number(),
  checksum: z.string().nullable(),
  status: z.enum(nodeStatusEnum.enumValues),
  deletedAt: z.date().nullable(),
  deletedBy: z.string().nullable(),
  isFavorite: z.boolean(),
  meta: fileNodeMetaSchema,
  lastAccessedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const fileNodeListSchema = pageSchema(fileNodeSchema);
export const fileNodeArraySchema = z.array(fileNodeSchema);

export const listFilesInput = paginationSchema.extend({
  connectionId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
  keyword: z.string().nullish(),
  type: z.enum(["file", "folder"]).nullish(),
  sort: sortSchema.optional(),
});

export const treeInput = z.object({
  connectionId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
});

export const nodeIdInput = z.object({ nodeId: z.uuid() });

export const nodeIdsInput = z.object({ nodeIds: z.array(z.uuid()).min(1) });

export const mkdirInput = z.object({
  connectionId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
  name: z.string().min(1).max(255),
});

export const renameInput = z.object({
  nodeId: z.uuid(),
  name: z.string().min(1).max(255),
});

export const moveInput = z.object({
  nodeIds: z.array(z.uuid()).min(1),
  targetParentId: z.uuid().nullish(),
});

export const movedSchema = z.object({ moved: z.number() });
export const removedSchema = z.object({ removed: z.number() });
export const restoredSchema = z.object({ restored: z.number() });
export const purgedSchema = z.object({ purged: z.number() });

export const fileStatsSchema = z.object({
  node: fileNodeSchema,
  connectionName: z.string(),
  storageKey: z.string(),
  shareCount: z.number(),
});
