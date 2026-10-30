# Creates a "Restaurant POS" desktop icon that opens the POS like a desktop app.
#   Server PC:  powershell -ExecutionPolicy Bypass -File scripts\create-desktop-shortcut.ps1 -Server
#   Other PCs:  powershell -ExecutionPolicy Bypass -File create-desktop-shortcut.ps1 -Url http://172.16.200.87:3000
# On other PCs only this file is needed; it downloads the icon from the server.
param(
  [string]$Url = "http://localhost:3000",
  [string]$Name = "Restaurant POS",
  [switch]$Server
)
$ErrorActionPreference = "Stop"
$Url = $Url.TrimEnd("/")
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "$Name.lnk"))

if ($Server) {
  # Starts the server when needed, then opens the app window.
  $root = Split-Path -Parent $PSScriptRoot
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\open-pos.ps1`" -Url `"$Url`" -StartServer"
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = "$root\app\favicon.ico"
} else {
  $browsers = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $browser = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $browser) { throw "Install Microsoft Edge or Google Chrome first." }
  $shortcut.TargetPath = $browser
  $shortcut.Arguments = "--app=$Url --start-maximized"
  $iconDir = Join-Path $env:LOCALAPPDATA "RestaurantPOS"
  New-Item -ItemType Directory -Force $iconDir | Out-Null
  $icon = Join-Path $iconDir "pos.ico"
  try { Invoke-WebRequest "$Url/favicon.ico" -OutFile $icon -UseBasicParsing -TimeoutSec 10; $shortcut.IconLocation = $icon }
  catch { Write-Warning "Could not download the icon from $Url (is the server running?). Using the browser icon." }
}

$shortcut.Save()
Write-Host "Created desktop icon '$Name' -> $Url"
