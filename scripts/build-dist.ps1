<#
  RelayForge — clean dist build.

  Produces a release zip of the project with all runtime / secret /
  generated artefacts stripped out, so it is safe to hand to someone
  else or upload as a release.

  Usage (from the project root):

      powershell -ExecutionPolicy Bypass -File scripts\build-dist.ps1

  The script:
    1. Copies the project into a temp directory.
    2. Removes .env, config.json, tool-env.*, data/, backups/,
       node_modules/, .agent-collab/, *.log, *.err, openrelay-*.log,
       package-lock.json and known scratch notes.
    3. Runs the pre-release check (config loads, no obvious keys,
       text files are UTF-8, no extra junk).
    4. Zips the cleaned tree into
        relayforge-<version>.zip next to the project root.
#>

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $Root

$manifest = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw "package.json is missing a version field" }

$distName = "relayforge-$version"
$stage = Join-Path $env:TEMP $distName
$outZip = Join-Path $Root ("$distName.zip")

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $outZip) { Remove-Item $outZip -Force }

# 1. Copy the project tree.
# Exclude: runtime / secret dirs, .env / config, AND any stale version
# directories (`openrelay-local-safe-*`) plus previous build zips.
# Otherwise the new zip can end up containing an old copy of the
# project, which makes the release check meaningless and confuses
# end users who open the wrong copy.
#
# 0.6.4: `.env` is explicitly excluded from the release zip.
# The zip ships `.env.example` as the template. Operators
# copy `.env.example` to `.env` on first install.
$excludeFromCopy = @(
  "node_modules",
  "data",
  "backups",
  "dist",
  ".agent-collab",
  "config.json",
  "tool-env.ps1",
  "tool-env.cmd",
  "tool-env.sh",
  "package-lock.json"
)
$robocopyArgs = @(
  $Root,
  $stage,
  "/MIR",
  "/XD", "node_modules", "data", "backups", "dist", ".agent-collab", ".claude", "openrelay-local-safe-0.2.0", "openrelay-local-safe-0.2.1", "openrelay-local-safe-0.2.2", "openrelay-local-safe-0.2.3", "openrelay-local-safe-0.3.0", "openrelay-local-safe-0.3.1",
  "/XF", ".env", "config.json", "tool-env.ps1", "tool-env.cmd", "tool-env.sh", "tool-verify.ps1", "tool-verify.cmd", "tool-verify.sh", "package-lock.json", "*.zip", "_new_section.txt", "_s.txt", "OPENCODE_HANDOFF_*.md", "CODEX_HANDOFF_*.md", "*.docx", "*.doc",
  "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:0", "/W:0"
)
$robocopy = & robocopy @robocopyArgs
# Robocopy exit code 0-7 means success / partial success; 8+ means failure.
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

# 1a. Warn loudly if there are stale version directories in the
# project root — they won't be copied into the stage (the /XD list
# above excludes them) but a fresh operator should clean them up so
# they don't get accidentally zipped in a future ad-hoc build.
$staleDirs = @()
Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Name -like "openrelay-local-safe-*" -or $_.Name -like "openrelay-like-*" -or $_.Name -like "relayforge-*") {
    $staleDirs += $_.FullName.Substring($Root.Path.Length + 1)
  }
}
if ($staleDirs.Count -gt 0) {
  Write-Host ""
  Write-Host "WARNING: stale version directories in project root:"
  $staleDirs | ForEach-Object { Write-Host "  - $_" }
  Write-Host "These are excluded from this build but should be deleted manually before the next build."
  Write-Host ""
}

# 1b. Same for stale build zips. We do NOT delete them automatically
# (the operator may want to keep them around for comparison), but we
# warn so they don't accidentally ship in a manual ad-hoc zip.
$staleZips = @()
Get-ChildItem -LiteralPath $Root -Filter "*.zip" -ErrorAction SilentlyContinue | ForEach-Object {
  $staleZips += $_.FullName.Substring($Root.Path.Length + 1)
}
if ($staleZips.Count -gt 0) {
  Write-Host "WARNING: previous build zips in project root (excluded from this build):"
  $staleZips | ForEach-Object { Write-Host "  - $_" }
  Write-Host ""
}

# 2. Sweep additional generated artefacts.
$junkPatterns = @(
  "*.log",
  "*.err",
  "*.tmp",
  "*.bak",
  "openrelay-*.log",
  "openrelay-*.err",
  "openrelay-local-safe-*.zip"
)
$junkFound = @()
Get-ChildItem -LiteralPath $stage -Recurse -File -Force | ForEach-Object {
  foreach ($pattern in $junkPatterns) {
    if ($_.Name -like $pattern) {
      $junkFound += $_.FullName.Substring($stage.Length + 1)
      Remove-Item -LiteralPath $_.FullName -Force
      break
    }
  }
}

# 3. Sanity: forbidden names must not appear at all. Wildcards are
# supported by Get-ChildItem -Filter.
# 0.6.2: `.env` removed from this list. See the comment above
# on the robocopy /XF list for the rationale (the
# pre-release secret scanner still catches real keys in
# `.env` before the zip is built).
$forbiddenNames = @(".env", "config.json", "tool-env.ps1", "tool-env.cmd", "tool-env.sh", "tool-verify.ps1", "tool-verify.cmd", "tool-verify.sh", "data", "backups", "node_modules", ".agent-collab", ".claude", "OPENCODE_HANDOFF_*.md", "CODEX_HANDOFF_*.md", "*.docx", "*.doc")
$forbiddenFound = @()
foreach ($name in $forbiddenNames) {
  Get-ChildItem -LiteralPath $stage -Recurse -Force -Filter $name -ErrorAction SilentlyContinue | ForEach-Object {
    $forbiddenFound += $_.FullName.Substring($stage.Length + 1)
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
  }
}

# 4. Run pre-release check on the staged tree in strict mode.
$preReleaseScript = Join-Path $Root "scripts\pre-release-check.mjs"
if (Test-Path $preReleaseScript) {
  $env:OPENRELAY_ROOT = $stage
  try {
    Push-Location $Root
    & node $preReleaseScript --strict
  } finally {
    Pop-Location
    Remove-Item Env:\OPENRELAY_ROOT -ErrorAction SilentlyContinue
  }
  if ($LASTEXITCODE -ne 0) {
    throw "pre-release check failed (exit $LASTEXITCODE). Refusing to ship."
  }
}

# 5. Zip it up. Use ZipArchive directly so entry names always use
# forward slashes, even when the build runs on Windows.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipStream = [System.IO.File]::Open($outZip, [System.IO.FileMode]::CreateNew)
try {
  $zipArchive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $stage -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
      $relative = $_.FullName.Substring($stage.Length).TrimStart('\', '/').Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zipArchive,
        $_.FullName,
        $relative,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $zipArchive.Dispose()
  }
} finally {
  $zipStream.Dispose()
}

$verifyZipScript = Join-Path $Root "scripts\verify-zip.mjs"
if (Test-Path $verifyZipScript) {
  & node $verifyZipScript $outZip
  if ($LASTEXITCODE -ne 0) {
    throw "zip verification failed (exit $LASTEXITCODE). Refusing to ship."
  }
}

$sizeKb = [math]::Round((Get-Item $outZip).Length / 1KB, 1)
Write-Host ""
Write-Host "Built $outZip ($sizeKb KB)"
Write-Host ""
Write-Host "Stripped before zipping:"
if ($junkFound.Count -eq 0) { Write-Host "  (no junk files)" } else { $junkFound | ForEach-Object { Write-Host "  - $_" } }
Write-Host ""
Write-Host "Refused to ship these (deleted from stage):"
if ($forbiddenFound.Count -eq 0) { Write-Host "  (none)" } else { $forbiddenFound | ForEach-Object { Write-Host "  - $_" } }
Write-Host ""
Write-Host "Inspect before publishing: explorer $stage"
