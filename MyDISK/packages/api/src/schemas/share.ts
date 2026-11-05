import * as z from "zod";

import { nodeTypeEnum, shareStatusEnum } from "@MyDISK/db/schema";

import { pageSchema, paginationSchema } from "./common";

/**
 * 管理端分享视图（白名单）：绝不携带 `passwordHash`，也不暴露文件物理键与归属。
 * 新增敏感列不会自动进入本 schema（`A3` §8）。
 */
export const publicShareSchema = z.object({
  id: z.uuid(),
  token: z.string(),
  nodeId: z.uuid(),
  nodeName: z.string(),
  nodeType: z.enum(nodeTypeEnum.enumValues),
  nodeSize: z.number(),
  hasPassword: z.boolean(),
  expiresAt: z.date().nullable(),
  maxDownloads: z.number().int().nullable(),
  downloadCount: z.number().int(),
  canPreview: z.boolean(),
  canDownload: z.boolean(),
  canList: z.boolean(),
  status: z.enum(shareStatusEnum.enumValues),
  lastAccessedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PublicShare = z.infer<typeof publicShareSchema>;

const shareTokenSchema = z.string().trim().min(1).max(64);

const optionalPasswordInput = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((value) => (value === undefined || value === "" ? null : value))
  .pipe(z.string().min(4, "分享密码至少 4 个字符").nullable());

export const shareCreateInput = z.object({
  nodeId: z.uuid(),
  password: optionalPasswordInput,
  expiresAt: z.coerce.date().nullable().optional(),
  maxDownloads: z.number().int().positive("下载次数上限必须为正整数").nullable().optional(),
  canPreview: z.boolean().default(true),
  canDownload: z.boolean().default(true),
  canList: z.boolean().default(true),
});

export type ShareCreateInput = z.infer<typeof shareCreateInput>;

export const shareCreateOutput = z.object({ token: z.string(), url: z.string() });

export const shareListInput = paginationSchema.extend({
  nodeId: z.uuid().optional(),
});

export const shareListSchema = pageSchema(publicShareSchema);

export const shareUpdateInput = z.object({
  id: z.uuid(),
  /** 不传 = 不改；`null` = 清除密码；字符串 = 重新设置 */
  password: z
    .union([z.string().trim().min(4, "分享密码至少 4 个字符").max(64), z.null()])
    .optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  maxDownloads: z.number().int().positive().nullable().optional(),
  canPreview: z.boolean().optional(),
  canDownload: z.boolean().optional(),
  canList: z.boolean().optional(),
});

export type ShareUpdateInput = z.infer<typeof shareUpdateInput>;

export const shareIdInput = z.object({ id: z.uuid() });

export const shareAccessLogInput = paginationSchema.extend({ id: z.uuid() });

export const shareAccessLogSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  nodeId: z.uuid().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.date(),
});

export const shareAccessLogListSchema = pageSchema(shareAccessLogSchema);

export type ShareAccessLog = z.infer<typeof shareAccessLogSchema>;

/* ------------------------------------------------------------------ */
/* 公开分享（无登录，凭 token + 可选 access token）                    */
/* ------------------------------------------------------------------ */

export const publicFileNodeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(nodeTypeEnum.enumValues),
  size: z.number(),
  mime: z.string().nullable(),
  updatedAt: z.date(),
});

export type PublicFileNode = z.infer<typeof publicFileNodeSchema>;

export const publicShareNodeInfoSchema = z.object({
  name: z.string(),
  type: z.enum(nodeTypeEnum.enumValues),
  size: z.number(),
});

export const publicShareInfoInput = z.object({ token: shareTokenSchema });

export const publicShareInfoSchema = z.object({
  node: publicShareNodeInfoSchema,
  needPassword: z.boolean(),
  canPreview: z.boolean(),
  canDownload: z.boolean(),
  canList: z.boolean(),
  expiresAt: z.date().nullable(),
});

export type PublicShareInfo = z.infer<typeof publicShareInfoSchema>;

export const publicShareUnlockInput = z.object({
  token: shareTokenSchema,
  password: z.string().min(1, "请输入密码").max(128),
});

export const publicShareUnlockOutput = z.object({ shareToken: z.string() });

export const publicShareListInput = paginationSchema.extend({
  token: shareTokenSchema,
  shareToken: z.string().min(1).optional(),
  parentNodeId: z.uuid().nullish(),
});

export const publicShareListSchema = pageSchema(publicFileNodeSchema);

export const publicShareDownloadInput = z.object({
  token: shareTokenSchema,
  shareToken: z.string().min(1).optional(),
  nodeId: z.uuid().optional(),
});

export const publicShareDownloadOutput = z.object({ url: z.string() });

/**
 * `/api/raw/share/:token/:nodeId` 的 query（二进制面，`A3` §7/§11.4）。
 * `dl` / `inline` 只认 `"1"`，与手写 spec 的 `enum: ["1"]` 对齐。
 */
export const shareRawQuerySchema = z.object({
  access: z.string().min(1).optional(),
  dl: z.literal("1").optional(),
  inline: z.literal("1").optional(),
});

export const shareRawParamSchema = z.object({
  token: shareTokenSchema,
  nodeId: z.uuid(),
});
