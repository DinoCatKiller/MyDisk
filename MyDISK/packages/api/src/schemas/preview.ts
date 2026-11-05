import * as z from "zod";

/** 预览类型（`A6` §7），由 `detectPreviewKind` 判定，驱动前端渲染分支 */
export const previewKindEnum = z.enum([
  "image",
  "video",
  "audio",
  "pdf",
  "markdown",
  "text",
  "unknown",
]);

export type PreviewKind = z.infer<typeof previewKindEnum>;

export const previewUrlInput = z.object({
  nodeId: z.uuid(),
  inline: z.boolean().default(true),
  download: z.boolean().default(false),
});

export const previewUrlSchema = z.object({
  url: z.string(),
  ttl: z.number(),
});

export const previewInfoInput = z.object({
  nodeId: z.uuid(),
});

/** 预览节点元信息（前端渲染前预取：类型判定 + 大小阈值） */
export const previewInfoSchema = z.object({
  nodeId: z.uuid(),
  name: z.string(),
  mime: z.string().nullable(),
  size: z.number(),
  kind: previewKindEnum,
  /** 文本/Markdown 是否需要截断（前端只加载前 2MB） */
  textTruncated: z.boolean(),
});

export type PreviewInfo = z.infer<typeof previewInfoSchema>;
