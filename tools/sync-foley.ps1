# Sync the deployable part of Foley Fun into the website.
#   Source : D:\Coding_Expirements\foley   (the project you develop in)
#   Target : <website>\foley               (what gets published at bitswizzler.io/foley/)
# Copies index.html, css\, js\, vendor\ (mirrored) and skips archive\, starter-kit\ (already
# bundled into js\app\starter-kit.js) and README.md. Then patches the copied index.html:
#   - <meta name="robots" content="noindex">  so the lab page stays out of search results
#   - <script src="site-link.js">             adds the "BitSwizzler.io" back-link to Foley's top bar
# site-link.js lives only in the website copy and is never touched by the sync.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\sync-foley.ps1 [-Source <path>]

param(
  [string]$Source = "D:\Coding_Expirements\foley"
)
$ErrorActionPreference = 'Stop'
$Target = Join-Path (Split-Path $PSScriptRoot -Parent) 'foley'

if (-not (Test-Path (Join-Path $Source 'index.html'))) { throw "No index.html in $Source" }
New-Item -ItemType Directory -Force $Target | Out-Null

foreach ($dir in 'css', 'js', 'vendor') {
  $src = Join-Path $Source $dir; $dst = Join-Path $Target $dir
  if (Test-Path $src) {
    robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $dir (code $LASTEXITCODE)" }
  }
}
Copy-Item (Join-Path $Source 'index.html') (Join-Path $Target 'index.html') -Force

# --- patch the copied index.html (idempotent) ---
$idx = Join-Path $Target 'index.html'
$html = Get-Content $idx -Raw
if ($html -notmatch 'name="robots"') {
  $html = $html -replace '(\s*)<title>', "`$1<meta name=`"robots`" content=`"noindex`">`$1<title>"
}
if ($html -notmatch 'site-link\.js') {
  $html = $html -replace '</body>', "  <script src=`"site-link.js`"></script>`n</body>"
}
Set-Content $idx $html -NoNewline -Encoding UTF8

$count = (Get-ChildItem $Target -Recurse -File | Measure-Object).Count
$size = [math]::Round((Get-ChildItem $Target -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 2)
Write-Host "Synced Foley Fun -> $Target  ($count files, $size MB)"
