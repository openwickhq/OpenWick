# OpenWick installer for Windows. One command, in PowerShell:
#
#   irm https://raw.githubusercontent.com/openwickhq/OpenWick/main/install.ps1 | iex
#
# What it does, all inside your user folder (no admin rights):
#   1. Uses your Node.js 18+ if you have it; otherwise downloads Node.js from nodejs.org into
#      %LOCALAPPDATA%\OpenWick\node (checksum-verified). Nothing is installed system-wide.
#   2. Downloads the latest OpenWick release into %LOCALAPPDATA%\OpenWick\app.
#   3. Adds a `openwick` command, Start menu and desktop shortcuts, then starts it.
# Run it again to update; your watchlists, drawings, alerts and indicators are kept.
#
# Options (environment variables): OPENWICK_HOME, OPENWICK_SOURCE (a .zip file or URL),
# OPENWICK_NO_START=1, OPENWICK_NO_SHORTCUTS=1.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # much faster downloads in Windows PowerShell 5
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo     = if ($env:OPENWICK_REPO) { $env:OPENWICK_REPO } else { "openwickhq/OpenWick" }
$AppId    = "openwick"
$AppName  = "OpenWick"
$NodeLine = "latest-v24.x"
$HomeDir  = if ($env:OPENWICK_HOME) { $env:OPENWICK_HOME } else { Join-Path $env:LOCALAPPDATA "OpenWick" }

function Step($t) { Write-Host ""; Write-Host $t -ForegroundColor White }
# throw, not exit: run through "irm | iex", exit would close the person's PowerShell window.
function Fail($t) { throw "$AppName install stopped: $t" }
function NodeOk($exe) {
  try { & $exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" 2>$null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

Write-Host ""
Write-Host "  $AppName installer. Created by Sourav Chakraborty, open source (MIT)."
Write-Host "  Installs into $HomeDir. No admin rights needed."

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("owinstall-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Tmp, $HomeDir | Out-Null
Set-Content -Path (Join-Path $HomeDir ".openwick-install") -Value "$AppName install folder. Remove with: $AppId uninstall"

try {
  # ---------- 1. Node.js ----------
  Step "1/4  Node.js"
  $Node = $null
  $own = Join-Path $HomeDir "node\node.exe"
  $sys = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ((Test-Path $own) -and (NodeOk $own)) { $Node = $own; Write-Host "Using $AppName's own Node.js $(& $Node -v)." }
  elseif ($sys -and (NodeOk $sys)) { $Node = $sys; Write-Host "Using your Node.js $(& $Node -v)." }
  else {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    Write-Host "Node.js 18+ not found. Downloading it from nodejs.org into $HomeDir\node (only $AppName uses it)."
    $base = "https://nodejs.org/dist/$NodeLine"
    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content -split "`n"
    $line = $sums | Where-Object { $_ -match " node-v[0-9.]+-win-$arch\.zip$" } | Select-Object -First 1
    if (-not $line) { Fail "Couldn't find Node.js for win-$arch on nodejs.org." }
    $want, $file = ($line.Trim() -split "\s+")
    $zip = Join-Path $Tmp $file
    Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $want.ToLower()) { Fail "The Node.js download didn't match its checksum. Try again." }
    $unz = Join-Path $Tmp "node"
    Expand-Archive $zip -DestinationPath $unz -Force
    $inner = Get-ChildItem $unz -Directory | Select-Object -First 1
    $dest = Join-Path $HomeDir "node"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Move-Item $inner.FullName $dest
    $Node = $own
    if (-not (NodeOk $Node)) { Fail "The downloaded Node.js doesn't run on this computer." }
    Write-Host "Node.js $(& $Node -v) ready."
  }

  # ---------- 2. OpenWick ----------
  Step "2/4  $AppName"
  $archive = Join-Path $Tmp "app.zip"
  if ($env:OPENWICK_SOURCE) {
    if ($env:OPENWICK_SOURCE -match "^https?://") { Invoke-WebRequest -UseBasicParsing $env:OPENWICK_SOURCE -OutFile $archive }
    elseif (Test-Path $env:OPENWICK_SOURCE) { Copy-Item $env:OPENWICK_SOURCE $archive }
    else { Fail "No file at $($env:OPENWICK_SOURCE)" }
    Write-Host "From $($env:OPENWICK_SOURCE)"
  } else {
    if ($Repo -like "OWNER/*") { Fail "This copy of the installer doesn't know its GitHub address yet (Repo is a placeholder)." }
    try {
      Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo/releases/latest/download/$AppId.zip" -OutFile $archive
      Write-Host "Latest release from github.com/$Repo"
    } catch {
      Write-Host "No release yet; using the newest code from github.com/$Repo"
      Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $archive
    }
  }
  $unz = Join-Path $Tmp "app"
  Expand-Archive $archive -DestinationPath $unz -Force
  $src = Get-ChildItem $unz -Directory | Select-Object -First 1
  if (-not $src -or -not (Test-Path (Join-Path $src.FullName "server.js"))) { Fail "The download doesn't look like $AppName (no server.js)." }

  $App = Join-Path $HomeDir "app"
  if (Test-Path $App) {
    Write-Host "Updating. Your data is kept."
    & $Node (Join-Path $App "scripts\stop.js") *> $null
    if (Test-Path (Join-Path $App "data")) { Copy-Item (Join-Path $App "data") $src.FullName -Recurse -Force }
    $customOld = Join-Path $App "custom"; $customNew = Join-Path $src.FullName "custom"
    if (Test-Path $customOld) {
      New-Item -ItemType Directory -Force -Path $customNew | Out-Null
      Get-ChildItem $customOld | Where-Object { -not (Test-Path (Join-Path $customNew $_.Name)) } | Copy-Item -Destination $customNew -Recurse
    }
    Remove-Item $App -Recurse -Force
  }
  Move-Item $src.FullName $App
  $version = (Get-Content (Join-Path $App "package.json") -Raw | ConvertFrom-Json).version
  Write-Host "$AppName $version is in $App"

  # ---------- 3. The openwick command and shortcuts ----------
  Step "3/4  Shortcuts"
  $Bin = Join-Path $HomeDir "bin"
  New-Item -ItemType Directory -Force -Path $Bin | Out-Null
  $cmdFile = Join-Path $Bin "$AppId.cmd"
  Set-Content -Path $cmdFile -Encoding ASCII -Value @"
@echo off
rem $AppName`: start, stop, update or uninstall. Run "$AppId help".
set "OPENWICK_HOME=$HomeDir"
set "OW_NODE=$Node"
if not exist "%OW_NODE%" set "OW_NODE=node"
"%OW_NODE%" "$App\scripts\cli.js" %*
"@
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (($userPath -split ";") -contains $Bin)) {
    [Environment]::SetEnvironmentVariable("Path", (($userPath.TrimEnd(";") + ";" + $Bin).TrimStart(";")), "User")
    Write-Host "Added the $AppId command to your PATH (open a new terminal to use it)."
  }
  if ($env:OPENWICK_NO_SHORTCUTS -ne "1") {
    $shell = New-Object -ComObject WScript.Shell
    $targets = @(
      (Join-Path ([Environment]::GetFolderPath("Programs")) "$AppName.lnk"),
      (Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk")
    )
    foreach ($t in $targets) {
      $lnk = $shell.CreateShortcut($t)
      $lnk.TargetPath = $cmdFile
      $lnk.Arguments = "start"
      $lnk.WorkingDirectory = $App
      $lnk.WindowStyle = 7   # minimised: the window closes on its own once the app is up
      $lnk.Description = "Charts for stocks, indices and crypto"
      $lnk.Save()
    }
    Write-Host "Added $AppName to the Start menu and the desktop."
  }

  # ---------- 4. Start ----------
  Step "4/4  Start"
  if ($env:OPENWICK_NO_START -eq "1") { Write-Host "Skipped (OPENWICK_NO_START=1)." }
  else {
    & $Node (Join-Path $App "scripts\cli.js") start
    if ($LASTEXITCODE -ne 0) { Fail "It didn't start. Run `"$AppId doctor`" to see why." }
  }

  Write-Host ""
  Write-Host "Done. Next time, use the Start menu or desktop shortcut, or in a new terminal:"
  Write-Host "  $AppId            start it and open your browser"
  Write-Host "  $AppId stop       stop it"
  Write-Host "  $AppId update     get the newest version (keeps your data)"
  Write-Host "  $AppId uninstall  remove it"
  Write-Host ""
} finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
