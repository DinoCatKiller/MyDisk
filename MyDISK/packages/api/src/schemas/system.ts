import * as z from "zod";

/** 系统设置是自由键值对 */
export const settingsSchema = z.record(z.string(), z.unknown());

export const updateSettingsInput = z.object({
  settings: z.record(z.string(), z.unknown()),
});

export const installStatusSchema = z.object({
  installed: z.boolean(),
  installedAt: z.string().nullable(),
});

export const systemStatsSchema = z.object({
  fileCount: z.number(),
  trashCount: z.number(),
  connectionCount: z.number(),
  shareCount: z.number(),
});
