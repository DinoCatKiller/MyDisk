import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { CommandModule } from "yargs";

import { hasLegacySchema, markBaselineApplied, pushSchema, runMigrations } from "../lib/bootstrap";
import { loadCliEnv } from "../lib/env";
import { logInfo, logWarn } from "../lib/prompts";

type DrizzleCommand = "push" | "generate" | "studio";

function runDrizzle(command: DrizzleCommand, extraArgs: string[] = []): void {
  const env = loadCliEnv();
  const cwd = join(env.projectRoot, "packages/db");

  if (command === "push") {
    const result = pushSchema(env);
    if (result.output) {
      console.log(result.output);
    }
    if (!result.ok) {
      logWarn("drizzle-kit push 执行失败");
      process.exit(1);
    }
    logInfo("数据库表结构已同步（仅开发期使用，发布走 db:migrate）");
    return;
  }

  const result = spawnSync("bunx", ["drizzle-kit", command, ...extraArgs], {
    cwd,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    logWarn(`drizzle-kit ${command} 执行失败`);
    process.exit(1);
  }
}

export const dbMigrateCommand: CommandModule = {
  command: "db:migrate",
  describe: "执行待应用的数据库迁移",
  handler: async () => {
    const env = loadCliEnv();
    try {
      await runMigrations(env);
    } catch (error) {
      logWarn(`数据库迁移失败：${(error as Error).message}`);
      process.exit(1);
    }
    logInfo("数据库迁移已完成");
  },
};

export const dbBaselineCommand: CommandModule = {
  command: "db:baseline",
  describe: "把已有表结构的旧库标记为已应用迁移（仅用于 db:push 建过的库）",
  handler: async () => {
    const env = loadCliEnv();
    if (!(await hasLegacySchema(env))) {
      logWarn("库里没有旧表结构，无需补基线；直接执行 db:migrate 即可");
      process.exit(1);
    }
    const inserted = await markBaselineApplied(env);
    if (inserted.length === 0) {
      logInfo("迁移基线已是最新，无需补写");
      return;
    }
    logInfo(`已补迁移基线：${inserted.join(", ")}`);
  },
};

export const dbPushCommand: CommandModule = {
  command: "db:push",
  describe: "同步数据库表结构（drizzle-kit push，仅开发期）",
  handler: () => {
    runDrizzle("push");
  },
};

export const dbGenerateCommand: CommandModule = {
  command: "db:generate",
  describe: "生成迁移文件（drizzle-kit generate）",
  handler: () => {
    runDrizzle("generate");
  },
};

export const dbStudioCommand: CommandModule = {
  command: "db:studio",
  describe: "打开数据库可视化面板（drizzle-kit studio）",
  handler: () => {
    runDrizzle("studio");
  },
};
