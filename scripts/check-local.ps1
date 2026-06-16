$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $Root

$Port = if ($env:PORT) { [int]$env:PORT } else { 18765 }
$DataDir = Join-Path $Root "data"
$BackupsDir = Join-Path $Root "backups"

$Result = [ordered]@{
  root = $Root.Path
  port = $Port
  dataDir = $DataDir
  dataDirWritable = $false
  backupsDir = $BackupsDir
  node = $null
  npm = $null
  nodeVersion = $null
  configExample = Test-Path -LiteralPath (Join-Path $Root "config.example.json")
  configJson = Test-Path -LiteralPath (Join-Path $Root "config.json")
  envFile = Test-Path -LiteralPath (Join-Path $Root ".env")
  envExample = Test-Path -LiteralPath (Join-Path $Root ".env.example")
  portInUse = $false
  health = $null
  healthDetail = $null
  configExampleParse = $null
  notes = @()
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $Result.node = $nodeCommand.Source
  try {
    $versionOutput = & $nodeCommand.Source --version 2>$null
    if ($versionOutput) {
      $Result.nodeVersion = ($versionOutput -replace 'v', '').Trim()
      $major = 0
      if ([int]::TryParse(($Result.nodeVersion -split '\.')[0], [ref]$major) -and $major -lt 18) {
        $Result.notes += "Node.js $($Result.nodeVersion) is older than the required >=18."
      }
    }
  } catch {}
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
  $Result.npm = $npmCommand.Source
}

if (-not (Test-Path -LiteralPath $DataDir)) {
  try {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
  } catch {
    $Result.notes += "Could not create data directory: $($_.Exception.Message)"
  }
}
try {
  $probe = Join-Path $DataDir ".doctor-write-probe"
  [System.IO.File]::WriteAllText($probe, "ok")
  Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  $Result.dataDirWritable = $true
} catch {
  $Result.dataDirWritable = $false
  $Result.notes += "data/ is not writable: $($_.Exception.Message)"
}

$configExamplePath = Join-Path $Root "config.example.json"
if ($Result.configExample) {
  try {
    $parsed = Get-Content -LiteralPath $configExamplePath -Raw | ConvertFrom-Json
    $providerCount = if ($parsed.providers) { @($parsed.providers).Count } else { 0 }
    $routeCount = if ($parsed.routes) { @($parsed.routes).Count } else { 0 }
    $profileCount = if ($parsed.profiles) { @($parsed.profiles).Count } else { 0 }
    $Result.configExampleParse = [ordered]@{
      ok = $true
      providers = $providerCount
      routes = $routeCount
      profiles = $profileCount
    }
  } catch {
    $Result.configExampleParse = [ordered]@{
      ok = $false
      message = $_.Exception.Message
    }
  }
}

$connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($connection) {
  $Result.portInUse = $true
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    $Result.health = @{
      ok = $health.ok
      configPath = $health.configPath
      providers = $health.providers.Count
      routes = $health.routes.Count
      profiles = $health.profiles.profiles.Count
      stats = $health.stats
      keys = ($health.keys.PSObject.Properties | ForEach-Object { @{ provider = $_.Name; count = @($_.Value).Count } })
    }
  } catch {
    $Result.health = @{ ok = $false; message = $_.Exception.Message }
  }
} else {
  $Result.notes += "Relay is not running on port $Port. Start it with .\start.ps1 or .\Start_OpenRelay_Local_Safe.cmd, then re-run doctor."
}

$Result | ConvertTo-Json -Depth 6
