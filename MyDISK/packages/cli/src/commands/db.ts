import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { CommandModule } from "yargs";

import { pushSchema } from "../lib/bootstrap";
import { loadCliEnv } from "../lib/env";
import { logInfo, logWarn } from "../lib/prompts";

type DrizzleCommand = "push" | "generate" | "studio" | "migrate";

function runDrizzle(command: DrizzleCommand, extraArgs: string[] = []): void {
  const env = loadCliEnv();
  const cwd = join(env.projectRoot, "packages/db");
  const bin = process.platform === "win32" ? "bunx.cmd" : "bunx";

  if (command === "push") {
    const result = pushSchema(env);
    if (result.output) {
      console.log(result.output);
    }
    if (!result.ok) {
      logWarn("drizzle-kit push 执行失败");
      process.exit(1);
    }
    logInfo("数据库表结构已同步");
    return;
  }

  const result = spawnSync(bin, ["drizzle-kit", command, ...extraArgs], {
    cwd,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    logWarn(`drizzle-kit ${command} 执行失败`);
    process.exit(1);
  }
}

export const dbPushCommand: CommandModule = {
  command: "db:push",
  describe: "同步数据库表结构（drizzle-kit push）",
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
