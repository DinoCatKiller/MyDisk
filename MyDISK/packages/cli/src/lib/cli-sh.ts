import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CLI_ENTRY = "packages/cli/src/index.ts";

const SH_TEMPLATE = `#!/usr/bin/env bash
# MyDisk 运维入口（由 install 命令生成，可安全重复执行）
set -euo pipefail
cd "$(dirname "$0")"

MARK="node_modules/.pstorage-installed"
CLI="${CLI_ENTRY}"

if [ ! -f "$MARK" ]; then
  echo "→ 检测到项目尚未安装，开始安装依赖…"
  bun install
  bun run "$CLI" install
else
  if [ "$#" -eq 0 ]; then
    bun run "$CLI"
  else
    bun run "$CLI" "$@"
  fi
fi
`;

const PS1_TEMPLATE = `# MyDisk 运维入口（由 install 命令生成）
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$mark = "node_modules/.pstorage-installed"
$cli = "${CLI_ENTRY}"

if (-not (Test-Path $mark)) {
  Write-Host "→ 检测到项目尚未安装，开始安装依赖…"
  bun install
  bun run $cli install
} elseif ($args.Count -eq 0) {
  bun run $cli
} else {
  bun run $cli @args
}
`;

export type GeneratedScripts = {
  shPath: string;
  ps1Path: string;
  shCreated: boolean;
  ps1Created: boolean;
};

/**
 * 在项目根目录生成 cli.sh / cli.ps1。
 * 已存在则跳过（幂等），符合「安装命令第一步：生成 cli.sh」的要求。
 */
export function generateCliScripts(projectRoot: string): GeneratedScripts {
  const shPath = join(projectRoot, "cli.sh");
  const ps1Path = join(projectRoot, "cli.ps1");

  const shCreated = !existsSync(shPath);
  const ps1Created = !existsSync(ps1Path);

  if (shCreated) {
    writeFileSync(shPath, SH_TEMPLATE, "utf8");
    try {
      chmodSync(shPath, 0o755);
    } catch {
      // Windows 下 chmod 可能不可用，忽略
    }
  }

  if (ps1Created) {
    writeFileSync(ps1Path, PS1_TEMPLATE, "utf8");
  }

  return { shPath, ps1Path, shCreated, ps1Created };
}
