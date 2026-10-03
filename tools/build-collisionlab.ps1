# Build CollisionLab (a LÖVE 11.x project) for the web.
#   Source : <website>\collisionlab\src   (the Lua -- edit it here, this repo owns it)
#   Target : <website>\collisionlab       (published at bitswizzler.io/collisionlab/)
# Steps: zip the *.lua tree into a .love -> run love.js (LÖVE compiled to WebAssembly, "compat"
# build so it works on plain static hosting) -> copy the runtime (love.wasm, love.js, game.js,
# game.data) into the target. The wrapper page collisionlab\index.html is hand-written and never
# overwritten; only the four runtime files are replaced.
# Requires Node.js. love.js is installed on first run into tools\node_modules.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\build-collisionlab.ps1

param(
  [string]$Source = "",
  [string]$Title = "CollisionLab"
)
$ErrorActionPreference = 'Stop'
$Tools  = $PSScriptRoot
$Site   = Split-Path $Tools -Parent
$Target = Join-Path $Site 'collisionlab'
$Build  = Join-Path $Tools 'build\collisionlab'
if (-not $Source) { $Source = Join-Path $Target 'src' }

if (-not (Test-Path (Join-Path $Source 'main.lua'))) { throw "No main.lua in $Source" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required (node not found on PATH)" }

# 1. love.js (once)
$loveJs = Join-Path $Tools 'node_modules\love.js\index.js'
if (-not (Test-Path $loveJs)) {
  Write-Host "Installing love.js into tools\node_modules ..."
  Push-Location $Tools
  try { npm install --no-audit --no-fund --loglevel=error | Out-Null } finally { Pop-Location }
  if (-not (Test-Path $loveJs)) { throw "love.js did not install" }
}

# 2. zip the Lua tree into a .love (zip of the project *contents*, not the folder)
New-Item -ItemType Directory -Force $Build | Out-Null
$love = Join-Path $Build 'game.love'
if (Test-Path $love) { Remove-Item $love -Force }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($love, 'Create')
try {
  Get-ChildItem $Source -Recurse -File -Include *.lua | ForEach-Object {
    $rel = $_.FullName.Substring($Source.TrimEnd('\').Length + 1) -replace '\\', '/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal') | Out-Null
  }
} finally { $zip.Dispose() }

# 3. love.js compat build (stdin redirected: love.js waits on stdin otherwise)
$out = Join-Path $Build 'out'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
$nul = Join-Path $env:TEMP 'nul.txt'; Set-Content $nul '' -NoNewline
$p = Start-Process -FilePath 'node' -ArgumentList @("`"$loveJs`"", '-c', '-t', "`"$Title`"", "`"$love`"", "`"$out`"") `
      -RedirectStandardInput $nul -NoNewWindow -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "love.js failed (exit $($p.ExitCode))" }

# 4. copy the runtime only; the wrapper index.html stays ours
New-Item -ItemType Directory -Force $Target | Out-Null
foreach ($f in 'love.wasm', 'love.js', 'game.js', 'game.data') {
  Copy-Item (Join-Path $out $f) (Join-Path $Target $f) -Force
}
if (-not (Test-Path (Join-Path $Target 'index.html'))) {
  Write-Warning "No wrapper index.html in $Target - copying love.js's default page; restyle it."
  Copy-Item (Join-Path $out 'index.html') (Join-Path $Target 'index.html')
  Copy-Item (Join-Path $out 'theme') (Join-Path $Target 'theme') -Recurse -Force
}

$size = [math]::Round((Get-ChildItem $Target -File | Measure-Object Length -Sum).Sum / 1MB, 2)
Write-Host "Built CollisionLab -> $Target  ($size MB; love.wasm is most of it)"
