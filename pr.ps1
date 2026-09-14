<#
.SYNOPSIS
一键 PR：检查 → 提交 → 推送。

.DESCRIPTION
纯 git/gh 通用逻辑，不依赖具体项目路径，在仓库根目录执行即可。
中文提交信息务必通过 -msgFile 传入（PS 5.1 直接传中文参数会乱码）。

.EXAMPLE
./pr.ps1 -msgFile .prmsg.txt
./pr.ps1 -msgFile .prmsg.txt -skipChecks
./pr.ps1 -msgFile .prmsg.txt -noPush
#>
param(
  [string]$msgFile,
  [string]$msg,
  [switch]$skipChecks,
  [switch]$noPush
)

$ErrorActionPreference = "Stop"

function Write-Info($message) { Write-Host "[pr] $message" -ForegroundColor Cyan }
function Write-Ok($message) { Write-Host "[pr] $message" -ForegroundColor Green }
function Fail($message) { Write-Host "[pr] $message" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 1. 提交信息
$tempMsg = Join-Path $env:TEMP ("pr-msg-" + [guid]::NewGuid().ToString("N") + ".txt")

if ($msgFile) {
  if (-not (Test-Path $msgFile)) { Fail "找不到消息文件：$msgFile" }
  # 读成 UTF-8，避免中文乱码
  $commitMsg = Get-Content -Raw -Encoding UTF8 $msgFile
} elseif ($msg) {
  $commitMsg = $msg
} else {
  Fail "请使用 -msgFile <文件> 或 -msg <文本> 提供提交信息"
}

if ([string]::IsNullOrWhiteSpace($commitMsg)) { Fail "提交信息为空" }

# 用无 BOM UTF-8 写入临时文件，交给 git commit -F
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempMsg, $commitMsg.Trim() + "`n", $utf8NoBom)

# ---------------------------------------------------------------- 2. 提交前检查
if (-not $skipChecks) {
  $scripts = @()
  if (Test-Path "package.json") {
    $pkg = Get-Content -Raw "package.json" | ConvertFrom-Json
    if ($pkg.scripts.PSObject.Properties.Name -contains "check") { $scripts += "check" }
    if ($pkg.scripts.PSObject.Properties.Name -contains "check-types") { $scripts += "check-types" }
    if ($pkg.scripts.PSObject.Properties.Name -contains "test") { $scripts += "test" }
  }

  foreach ($script in $scripts) {
    Write-Info "运行 bun run $script …"
    & bun run $script
    if ($LASTEXITCODE -ne 0) { Fail "bun run $script 失败，已中止提交" }
  }
}

# ---------------------------------------------------------------- 3. 提交
Write-Info "暂存全部变更 …"
& git add -A
if ($LASTEXITCODE -ne 0) { Fail "git add 失败" }

$staged = & git diff --cached --name-only
if (-not $staged) {
  Write-Info "没有需要提交的变更"
  Remove-Item $tempMsg -Force -ErrorAction SilentlyContinue
  exit 0
}

& git commit -F $tempMsg
if ($LASTEXITCODE -ne 0) { Fail "git commit 失败" }

$hash = (& git rev-parse --short HEAD).Trim()
Write-Ok "已提交 $hash"

# ---------------------------------------------------------------- 4. 推送
if (-not $noPush) {
  $remotes = & git remote
  if ($remotes -contains "origin") {
    $branch = (& git branch --show-current).Trim()
    Write-Info "推送到 origin/$branch …"
    & git push origin $branch
    if ($LASTEXITCODE -ne 0) { Fail "git push 失败（提交已完成，可稍后手动推送）" }
    Write-Ok "已推送"
  } else {
    Write-Info "未配置 origin，跳过推送"
  }
}

Remove-Item $tempMsg -Force -ErrorAction SilentlyContinue

Write-Host ""
& git --no-pager log -1 --stat --oneline
