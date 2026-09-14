# MyDisk 运维入口（由 install 命令生成）
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$mark = "node_modules/.pstorage-installed"
$cli = "packages/cli/src/index.ts"

if (-not (Test-Path $mark)) {
  Write-Host "→ 检测到项目尚未安装，开始安装依赖…"
  bun install
  bun run $cli install
} elseif ($args.Count -eq 0) {
  bun run $cli
} else {
  bun run $cli @args
}
