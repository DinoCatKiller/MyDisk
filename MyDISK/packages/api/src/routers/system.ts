import { count, eq, isNotNull, isNull } from "drizzle-orm";
import * as z from "zod";

import type { Database } from "@MyDISK/db";
import { fileNode, shareLink, storageConnection, systemSetting } from "@MyDISK/db/schema";

import { founderProcedure, protectedProcedure, publicProcedure } from "../index";

const settingsInput = z.object({
  settings: z.record(z.string(), z.unknown()),
});

/** 安装标记键，由 CLI install 写入 */
export const INSTALLED_AT_KEY = "installed_at";

async function readSettings(db: Database): Promise<Record<string, unknown>> {
  const rows = await db.select().from(systemSetting);
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

const health = publicProcedure
  .route({
    method: "GET",
    path: "/system/health",
    summary: "健康检查",
    description: "用于探活与前端连接状态指示",
    tags: ["system"],
  })
  .handler(() => "OK");

const installStatus = publicProcedure
  .route({
    method: "GET",
    path: "/system/install-status",
    summary: "查询安装状态",
    description: "未安装时前端引导用户执行 ./cli.sh install",
    tags: ["system"],
  })
  .handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(systemSetting)
      .where(eq(systemSetting.key, INSTALLED_AT_KEY))
      .limit(1);
    const installedAt = rows[0]?.value;
    return {
      installed: Boolean(installedAt),
      installedAt: typeof installedAt === "string" ? installedAt : null,
    };
  });

const getSettings = protectedProcedure
  .route({
    method: "GET",
    path: "/system/settings",
    summary: "读取系统设置",
    tags: ["system"],
  })
  .handler(({ context }) => readSettings(context.db));

const updateSettings = founderProcedure
  .route({
    method: "PATCH",
    path: "/system/settings",
    summary: "更新系统设置",
    tags: ["system"],
  })
  .input(settingsInput)
  .handler(async ({ input, context }) => {
    for (const [key, value] of Object.entries(input.settings)) {
      await context.db
        .insert(systemSetting)
        .values({ key, value })
        .onConflictDoUpdate({
          target: systemSetting.key,
          set: { value, updatedAt: new Date() },
        });
    }
    return readSettings(context.db);
  });

const stats = protectedProcedure
  .route({
    method: "GET",
    path: "/system/stats",
    summary: "概览统计",
    tags: ["system"],
  })
  .handler(async ({ context }) => {
    const [fileCountRow] = await context.db
      .select({ value: count() })
      .from(fileNode)
      .where(isNull(fileNode.deletedAt));
    const [trashCountRow] = await context.db
      .select({ value: count() })
      .from(fileNode)
      .where(isNotNull(fileNode.deletedAt));
    const [connectionCountRow] = await context.db
      .select({ value: count() })
      .from(storageConnection);
    const [shareCountRow] = await context.db.select({ value: count() }).from(shareLink);

    return {
      fileCount: fileCountRow?.value ?? 0,
      trashCount: trashCountRow?.value ?? 0,
      connectionCount: connectionCountRow?.value ?? 0,
      shareCount: shareCountRow?.value ?? 0,
    };
  });

export const systemRouter = {
  health,
  installStatus,
  getSettings,
  updateSettings,
  stats,
};
