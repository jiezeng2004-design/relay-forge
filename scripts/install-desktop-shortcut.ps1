$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Launcher = Join-Path $Root "Start_OpenRelay_Local_Safe.cmd"
if (-not (Test-Path -LiteralPath $Launcher)) {
  throw "Launcher not found: $Launcher"
}

$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "OpenRelay Local Safe.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Launcher
$Shortcut.WorkingDirectory = $Root.Path
$Shortcut.Description = "Start OpenRelay Local Safe"
$Shortcut.Save()

[pscustomobject]@{
  ok = $true
  shortcut = $ShortcutPath
  target = $Launcher
} | ConvertTo-Json -Depth 3
