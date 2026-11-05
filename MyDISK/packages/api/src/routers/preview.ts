import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import { fileNode } from "@MyDISK/db/schema";

import { detectPreviewKind, TEXT_PREVIEW_MAX_BYTES } from "../lib/preview";
import { protectedProcedure } from "../procedure";
import { buildRawUrl, signRawToken } from "../lib/raw-token";
import {
  previewInfoInput,
  previewInfoSchema,
  previewUrlInput,
  previewUrlSchema,
} from "../schemas/preview";

const TTL_SECONDS = 15 * 60;

const url = protectedProcedure
  .route({
    method: "GET",
    path: "/preview/{nodeId}/url",
    summary: "生成短时取流地址",
    description: "返回 /api/raw 的签名地址，用于下载或预览（图片 / 音视频）",
    tags: ["preview"],
  })
  .input(previewUrlInput)
  .output(previewUrlSchema)
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select({ id: fileNode.id, type: fileNode.type })
      .from(fileNode)
      .where(eq(fileNode.id, input.nodeId))
      .limit(1);
    const node = rows[0];
    if (!node) {
      throw new ORPCError("NOT_FOUND", { message: "文件不存在" });
    }
    if (node.type !== "file") {
      throw new ORPCError("BAD_REQUEST", { message: "目录不支持取流" });
    }

    const token = signRawToken(
      {
        nodeId: node.id,
        userId: context.session.user.id,
        exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      },
      context.signingSecret,
    );

    return {
      url: buildRawUrl(node.id, token, { inline: input.inline, download: input.download }),
      ttl: TTL_SECONDS,
    };
  });

const info = protectedProcedure
  .route({
    method: "GET",
    path: "/preview/{nodeId}",
    summary: "预览节点元信息",
    description: "返回 mime/大小/预览类型判定，前端据此选择渲染分支",
    tags: ["preview"],
  })
  .input(previewInfoInput)
  .output(previewInfoSchema)
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select({
        id: fileNode.id,
        name: fileNode.name,
        type: fileNode.type,
        mime: fileNode.mime,
        size: fileNode.size,
      })
      .from(fileNode)
      .where(eq(fileNode.id, input.nodeId))
      .limit(1);
    const node = rows[0];
    if (!node) {
      throw new ORPCError("NOT_FOUND", { message: "文件不存在" });
    }
    if (node.type !== "file") {
      throw new ORPCError("BAD_REQUEST", { message: "目录不支持预览" });
    }
    const kind = detectPreviewKind(node.mime, node.name);
    return {
      nodeId: node.id,
      name: node.name,
      mime: node.mime,
      size: node.size,
      kind,
      textTruncated: (kind === "text" || kind === "markdown") && node.size > TEXT_PREVIEW_MAX_BYTES,
    };
  });

export const previewRouter = {
  url,
  info,
};
