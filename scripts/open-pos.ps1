# Opens Restaurant POS in its own app window (Edge/Chrome app mode).
# -StartServer (server PC only): starts the POS server in the background first if it is not running.
param(
  [string]$Url = "http://localhost:3000",
  [switch]$StartServer
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$uri = [Uri]$Url

function Test-Server {
  $client = New-Object Net.Sockets.TcpClient
  try { $client.ConnectAsync($uri.Host, $uri.Port).Wait(1500) -and $client.Connected } catch { $false } finally { $client.Dispose() }
}

if ($StartServer -and -not (Test-Server)) {
  # Production build when one exists; otherwise fall back to the dev server.
  $mode = if (Test-Path (Join-Path $root ".next\BUILD_ID")) { "start" } else { "dev" }
  $log = Join-Path $root "pos-server.log"
  Start-Process -FilePath "node" -ArgumentList "scripts/run-app.mjs", $mode -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  for ($i = 0; $i -lt 120 -and -not (Test-Server); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Server)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Restaurant POS server did not start. See $log.err", "Restaurant POS") | Out-Null
    exit 1
  }
}

$browsers = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$Url", "--start-maximized" }
else { Start-Process $Url }
