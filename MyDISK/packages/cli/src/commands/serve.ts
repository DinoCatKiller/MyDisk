import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CommandModule } from "yargs";

import { loadCliEnv } from "../lib/env";
import { logInfo, logWarn } from "../lib/prompts";

/** 启动开发服务（web + server），等价于 bun run dev */
export function runServe(): void {
  const env = loadCliEnv();
  const child = spawn("bun", ["run", "dev"], {
    cwd: env.projectRoot,
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

/** 从本地服务导出 openapi.json，便于生成 SDK / 交给外部系统对接 */
export async function runOpenApiExport(url?: string): Promise<void> {
  const env = loadCliEnv();
  const target = url || `${env.BETTER_AUTH_URL}/openapi.json`;

  logInfo(`正在从 ${target} 获取 OpenAPI 文档 …`);

  try {
    const response = await fetch(target);
    if (!response.ok) {
      logWarn(`请求失败：HTTP ${response.status}`);
      process.exit(1);
    }
    const document = await response.json();
    const outputPath = join(env.projectRoot, "openapi.json");
    writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    logInfo(`已写入 ${outputPath}`);
  } catch (error) {
    logWarn(`导出失败：${(error as Error).message}`);
    logWarn("请确认服务已启动（./cli.sh serve），或使用 --url 指定地址");
    process.exit(1);
  }
}

export const serveCommand: CommandModule = {
  command: "serve",
  describe: "启动开发服务（web + server）",
  handler: () => {
    runServe();
  },
};

export const openapiCommand: CommandModule = {
  command: "openapi",
  describe: "导出 openapi.json",
  builder: (yargsInstance) =>
    yargsInstance.option("url", { type: "string", describe: "OpenAPI 文档地址" }),
  handler: async (argv) => {
    await runOpenApiExport(argv.url as string | undefined);
  },
};
