<#
  OpenRelay Local Safe — optional tray launcher (Windows).

  This is a *portable* helper. It does not install anything, does not
  touch your system environment, and is not required to run the relay.

  Usage (from the project root):

      powershell -ExecutionPolicy Bypass -File scripts\start-tray.ps1

  - Starts the relay in the background with the current PowerShell window.
  - Sits in the system tray with a small menu (open dashboard, open docs,
    stop and exit).
  - Closing the tray icon also stops the relay process.
#>

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $Root

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Port = if ($env:PORT) { [int]$env:PORT } else { 18765 }
$BaseUrl = "http://127.0.0.1:$Port"

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  [System.Windows.Forms.MessageBox]::Show(
    "Port $Port is already in use. Close the existing process or set PORT to a free port and try again.",
    "OpenRelay Local Safe",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  ) | Out-Null
  exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  [System.Windows.Forms.MessageBox]::Show(
    "Node.js (>= 18) was not found in PATH. Install Node.js first.",
    "OpenRelay Local Safe",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

$proc = Start-Process -FilePath $nodeCommand.Source `
  -ArgumentList "src\server.js" `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -PassThru

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Visible = $true
$notify.Text = "OpenRelay Local Safe (port $Port)"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open dashboard")
$openItem.Add_Click({ Start-Process "$BaseUrl/" | Out-Null })
$modelsItem = $menu.Items.Add("Open /v1/models")
$modelsItem.Add_Click({ Start-Process "$BaseUrl/v1/models" | Out-Null })
$menu.Items.Add("-") | Out-Null
$copyItem = $menu.Items.Add("Copy base URL")
$copyItem.Add_Click({ [System.Windows.Forms.Clipboard]::SetText("$BaseUrl/v1") })
$menu.Items.Add("-") | Out-Null
$stopItem = $menu.Items.Add("Stop and exit")
$stopItem.Add_Click({
  $notify.Visible = $false
  if ($proc -and -not $proc.HasExited) {
    try { $proc | Stop-Process -Force } catch {}
  }
  [System.Windows.Forms.Application]::Exit()
})
$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Start-Process "$BaseUrl/" | Out-Null })

# Watch the underlying process: if the relay exits on its own (crash, port
# conflict, etc.) drop the tray icon so the user is not left with a ghost.
$watcher = {
  if ($proc -and $proc.HasExited) {
    $notify.Visible = $false
    $notify.ShowBalloonTip(
      4000,
      "OpenRelay Local Safe stopped",
      "The relay process exited with code $($proc.ExitCode). See the open log window for details.",
      [System.Windows.Forms.ToolTipIcon]::Warning
    )
    [System.Windows.Forms.Application]::Exit()
  }
}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick($watcher)
$timer.Start()

# Show a balloon once the server reports healthy.
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/health" -TimeoutSec 2 -UseBasicParsing
    if ($resp.StatusCode -eq 200) {
      $notify.ShowBalloonTip(
        3000,
        "OpenRelay Local Safe",
        "Listening on $BaseUrl",
        [System.Windows.Forms.ToolTipIcon]::Info
      )
      break
    }
  } catch {
    # not ready yet
  }
}

[System.Windows.Forms.Application]::Run()

if ($proc -and -not $proc.HasExited) {
  try { $proc | Stop-Process -Force } catch {}
}
$timer.Stop()
$timer.Dispose()
$notify.Dispose()
