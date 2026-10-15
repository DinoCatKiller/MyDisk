import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as z from "zod";

import { fileNode } from "@MyDISK/db/schema";

import { protectedProcedure } from "../index";
import { buildRawUrl, signRawToken } from "../lib/raw-token";

const TTL_SECONDS = 15 * 60;

const url = protectedProcedure
  .route({
    method: "GET",
    path: "/preview/{nodeId}/url",
    summary: "生成短时取流地址",
    description: "返回 /api/raw 的签名地址，用于下载或预览（图片 / 音视频）",
    tags: ["preview"],
  })
  .input(
    z.object({
      nodeId: z.uuid(),
      inline: z.boolean().default(true),
      download: z.boolean().default(false),
    }),
  )
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

export const previewRouter = {
  url,
};
