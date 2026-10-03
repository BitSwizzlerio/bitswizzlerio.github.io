# Stage exactly what bitswizzler.io should serve into dist\.
#
# Use this for drag-and-drop hosts (Netlify drop, Cloudflare Pages direct upload).
# If you deploy from a git repo instead, you do not need this: .gitignore already
# keeps the masters out, so the host builds from the right set automatically.
#
# Left out: asset masters (full-res sculpts, *_full.mp4, hero PNGs, Escher.jpg), lab sources
# (collisionlab\src, foley\archive and starter-kit), tools\, README.md, serve.bat, dist\ itself.
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools\build-deploy.ps1

$ErrorActionPreference = 'Stop'
$Site = Split-Path $PSScriptRoot -Parent
$Dist = Join-Path $Site 'dist'

if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
New-Item -ItemType Directory -Force $Dist | Out-Null

# Directories copied whole (these hold only files the site serves)
$wholeDirs = 'css', 'js', 'foley', 'collisionlab',
             'assets\drawings', 'assets\digital', 'assets\videos', 'assets\images', 'assets\models'

foreach ($d in $wholeDirs) {
  $src = Join-Path $Site $d
  if (-not (Test-Path $src)) { continue }
  $dst = Join-Path $Dist $d
  robocopy $src $dst /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $d (exit $LASTEXITCODE)" }
}

# Pages at the root
foreach ($f in 'index.html', 'showcase.html') {
  Copy-Item (Join-Path $Site $f) (Join-Path $Dist $f) -Force
}

# Drop the masters that live alongside the derived files
$dropPatterns = @(
  'assets\models\Grogg.glb', 'assets\models\Joule.glb', 'assets\models\Monster.glb',
  'assets\models\TheEvidence.glb', 'assets\models\robot.glb',
  'assets\videos\*_full.mp4',
  'assets\images\*.png',
  'assets\drawings\Escher.jpg',
  'foley\README.md'
)
foreach ($pat in $dropPatterns) {
  Get-ChildItem (Join-Path $Dist $pat) -ErrorAction SilentlyContinue | Remove-Item -Force
}
# Lab sources and dev tooling live in the repo but are not part of the live site
foreach ($dir in 'collisionlab\src', 'foley\archive', 'foley\starter-kit') {
  $p = Join-Path $Dist $dir
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

# Report, and warn about anything a static host would choke on
$files = Get-ChildItem $Dist -Recurse -File
$mb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "dist\ ready: $($files.Count) files, $mb MB"

$oversize = $files | Where-Object { $_.Length -gt 25MB }
if ($oversize) {
  Write-Warning "Files over 25 MB (Cloudflare Pages rejects these):"
  $oversize | ForEach-Object { Write-Host "   $([math]::Round($_.Length/1MB,1)) MB  $($_.FullName.Substring($Dist.Length+1))" }
}

# Every local asset the pages reference must exist in dist\
$missing = @()
foreach ($page in 'index.html', 'showcase.html') {
  $html = Get-Content (Join-Path $Dist $page) -Raw
  foreach ($m in [regex]::Matches($html, '(?:src|href)="((?!https?:|//|#|mailto:)[^"]+)"')) {
    $rel = ($m.Groups[1].Value -split '[#?]')[0] -replace '/', '\'
    if ($rel -like '*\') { continue }
    if (-not (Test-Path (Join-Path $Dist $rel))) { $missing += "$page -> $rel" }
  }
  foreach ($m in [regex]::Matches($html, "url\('([^']+)'\)")) {
    $rel = ($m.Groups[1].Value -split '[#?]')[0] -replace '/', '\'
    if (-not (Test-Path (Join-Path $Dist $rel))) { $missing += "$page -> $rel" }
  }
}
if ($missing) {
  Write-Warning "Referenced files missing from dist\:"
  $missing | Sort-Object -Unique | ForEach-Object { Write-Host "   $_" }
} else {
  Write-Host "All referenced local files are present."
}
