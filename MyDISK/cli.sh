#!/usr/bin/env bash
# MyDisk 运维入口（由 install 命令生成，可安全重复执行）
set -euo pipefail
cd "$(dirname "$0")"

MARK="node_modules/.pstorage-installed"
CLI="packages/cli/src/index.ts"

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
