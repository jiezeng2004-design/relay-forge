&lt;#
.SYNOPSIS
  Windows quick diagnostic for openrelay-local-safe.
  Outputs Chinese-friendly check results to stdout.

.DESCRIPTION
  Checks Node.js, npm, port availability, config.json, .env,
  and dashboard reachability. Safe to run at any time (read-only).
#>

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$port = if ($env:PORT) { [int]$env:PORT } else { 18765 }
$allOk = $true

function Write-Check {
  param([string]$Label, [string]$Status, [string]$Suggestion)
  $icon = if ($Status -eq "OK") { "[OK]" } else { "[FAIL]" }
  Write-Host "$icon $Label"
  if ($Status -ne "OK") {
    Write-Host "      $Suggestion" -ForegroundColor Yellow
    $script:allOk = $false
  }
}

# 1. Node.js version
$nodeVer = "N/A"
try {
  $nodeVer = & "node" -v 2>&1
  if ($LASTEXITCODE -eq 0) { $nodeVer = $nodeVer.Trim() }
  else { throw "node -v exit code $LASTEXITCODE" }
  $reqVer = [Version]"18.0.0"
  $curVer = [Version]($nodeVer -replace '^v', '')
  if ($curVer -ge $reqVer) {
    Write-Check -Label "Node.js 版本 ($nodeVer) - 符合要求" -Status "OK"
  } else {
    Write-Check -Label "Node.js 版本 ($nodeVer) - 需要 &gt;= 18" -Status "FAIL" `
      -Suggestion "请升级 Node.js: https://nodejs.org 下载 LTS 版本"
  }
} catch {
  Write-Check -Label "Node.js - 未找到或无法运行" -Status "FAIL" `
    -Suggestion "请安装 Node.js >= 18: https://nodejs.org 下载 LTS 版本"
}

# 2. npm availability
try {
  $npmPath = & "where" "npm" 2>&1 | Select-Object -First 1
  if ($LASTEXITCODE -eq 0 -and $npmPath) {
    Write-Check -Label "npm 可用 ($npmPath)" -Status "OK"
  } else {
    throw "npm not found"
  }
} catch {
  Write-Check -Label "npm - 未找到" -Status "FAIL" `
    -Suggestion "安装 Node.js 时包含 npm, 或运行: npm install -g npm"
}

# 3. Port check
try {
  $portInUse = netstat -an 2>&1 | Select-String ":$port "
  if ($portInUse) {
    Write-Check -Label "端口 $port - 已被占用" -Status "FAIL" `
      -Suggestion "请先关闭占用端口的程序, 或设置环境变量 PORT=其他端口再启动"
  } else {
    Write-Check -Label "端口 $port - 未被占用" -Status "OK"
  }
} catch {
  Write-Check -Label "端口 $port - 无法检测" -Status "FAIL" `
    -Suggestion "请以管理员身份运行此脚本, 或手动运行: netstat -an | findstr ':$port '"
}

# 4. config.json check
$configPath = Join-Path $rootDir "config.json"
$configExamplePath = Join-Path $rootDir "config.example.json"
if (Test-Path $configPath) {
  try {
    $null = Get-Content $configPath -Raw | ConvertFrom-Json
    Write-Check -Label "config.json - 存在且 JSON 格式正确" -Status "OK"
  } catch {
    Write-Check -Label "config.json - 存在但 JSON 格式错误" -Status "FAIL" `
      -Suggestion "请检查 config.json 是否有语法错误, 参考 config.example.json"
  }
} elseif (Test-Path $configExamplePath) {
  Write-Check -Label "config.json - 不存在, 但存在 config.example.json" -Status "FAIL" `
    -Suggestion "请复制 config.example.json 为 config.json, 并按需修改配置"
} else {
  Write-Check -Label "config.json - 不存在" -Status "FAIL" `
    -Suggestion "请创建 config.json, 参考文档或 config.example.json"
}

# 5. .env file
$envPath = Join-Path $rootDir ".env"
if (Test-Path $envPath) {
  Write-Check -Label ".env 文件 - 存在" -Status "OK"
} else {
  Write-Check -Label ".env 文件 - 不存在" -Status "FAIL" `
    -Suggestion "请创建 .env 文件, 在其中设置 API Key: DEEPSEEK_API_KEYS=sk-xxx"
}

# 6. Dashboard reachability
try {
  $resp = curl.exe -s -o NUL -w "%{http_code}" "http://127.0.0.1:${port}/" 2>&1
  if ($resp -eq "200") {
    Write-Check -Label "Dashboard (http://127.0.0.1:${port}/) - 可访问" -Status "OK"
  } else {
    Write-Check -Label "Dashboard - 返回状态码 $resp" -Status "FAIL" `
      -Suggestion "请确保服务已启动, 或检查端口是否配置正确"
  }
} catch {
  Write-Check -Label "Dashboard - 无法访问" -Status "FAIL" `
    -Suggestion "请启动服务: npm start, 然后重试"
}

# Summary
Write-Host ""
if ($allOk) {
  Write-Host "所有检查通过! 服务运行正常。" -ForegroundColor Green
} else {
  Write-Host "存在需要处理的问题, 请参考上方的建议。" -ForegroundColor Yellow
}
