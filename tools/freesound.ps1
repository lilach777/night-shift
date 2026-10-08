# Freesound research helper (public pages only, rate-limited).
#   -Search "query"            -> top results (CC0 filter unless -AnyLicense), sorted by downloads
#   -Info id1,id2               -> title / licence / format / downloads / description
#   -Download id1,id2 -Dir path -> saves the HQ preview + appends licence info to <Dir>/LICENSES.json
param([string]$Search, [string[]]$Info, [string[]]$Download, [string]$Dir, [switch]$AnyLicense, [string]$Sort = 'Downloads+descending')
$ProgressPreference = 'SilentlyContinue'
$ua = @{ 'User-Agent' = 'Mozilla/5.0 (NightShift sound research)' }
function Get($url) { Start-Sleep -Milliseconds 3500; (Invoke-WebRequest -Uri $url -Headers $ua -UseBasicParsing -TimeoutSec 40).Content }
function Meta($id) {
  $h = Get "https://freesound.org/s/$id/"
  $o = [ordered]@{ id = $id }
  $o.title = ([regex]::Match($h, '<title>Freesound - (.*?)</title>')).Groups[1].Value
  $o.license = if ($h -match 'publicdomain/zero') { 'CC0 1.0' } elseif ($h -match 'licenses/by-nc') { 'CC BY-NC' } elseif ($h -match 'licenses/by/4') { 'CC BY 4.0' } elseif ($h -match 'licenses/by/3') { 'CC BY 3.0' } else { 'unknown' }
  $o.url = "https://freesound.org/s/$id/"
  $o.preview = ([regex]::Match($h, 'https://cdn\.freesound\.org/previews/[^"'' ]+?-hq\.mp3')).Value
  $o.type = ([regex]::Match($h, '(?i)(Wave|FLAC|AIFF|Ogg|MP3)\s*\(\.\w+\)')).Value
  $o.sr = ([regex]::Match($h, '([\d.]+)\s*Hz')).Groups[1].Value
  $o.bits = ([regex]::Match($h, '(\d+)\s*bit')).Groups[1].Value
  $o.dur = ([regex]::Match($h, '(\d+:\d+\.\d+)')).Groups[1].Value
  $o.downloads = ([regex]::Match($h, '(?s)([\d,]+)\s*</[^>]+>\s*downloads')).Groups[1].Value
  if (-not $o.downloads) { $o.downloads = ([regex]::Match($h, '([\d,]+) downloads')).Groups[1].Value }
  $o.desc = ([regex]::Match($h, '(?s)<meta name="description" content="(.*?)"')).Groups[1].Value
  [pscustomobject]$o
}
if ($Search) {
  $lic = if ($AnyLicense) { '' } else { '&f=license:%22Creative+Commons+0%22' }
  $h = Get ("https://freesound.org/search/?q=" + [uri]::EscapeDataString($Search) + $lic + "&s=$Sort")
  $seen = @{}
  foreach ($m in [regex]::Matches($h, '/people/([^/]+)/sounds/(\d+)/"[^>]*>\s*([^<]{3,120}?)\s*<')) {
    $id = $m.Groups[2].Value; if ($seen[$id]) { continue }; $seen[$id] = 1
    "{0,-8} {1,-18} {2}" -f $id, $m.Groups[1].Value, $m.Groups[3].Value.Trim()
  }
}
if ($Info) { foreach ($id in ($Info -join ',').Split(',')) { if ($id) { $m = Meta $id; "{0} | {1} | {2} | {3} {4}Hz/{5}bit {6} | dl {7}`n   {8}" -f $m.id, $m.license, $m.title, $m.type, $m.sr, $m.bits, $m.dur, $m.downloads, ($m.desc.Substring(0, [math]::Min(220, $m.desc.Length))) } } }
if ($Download) {
  New-Item -ItemType Directory -Force $Dir | Out-Null
  $licFile = Join-Path $Dir 'LICENSES.json'
  $all = @(); if (Test-Path $licFile) { $all = @(Get-Content $licFile -Raw | ConvertFrom-Json) }
  foreach ($id in ($Download -join ',').Split(',')) {
    if (-not $id) { continue }
    if ($all | Where-Object { $_.id -eq $id }) { if (Test-Path (Join-Path $Dir "fs_$id.mp3")) { "have $id"; continue } }
    try { $m = Meta $id } catch { "meta failed $id"; continue }
    if (-not $m.preview) { "no preview for $id"; continue }
    $out = Join-Path $Dir "fs_$id.mp3"
    if (-not ((Test-Path $out) -and (Get-Item $out).Length -gt 2000)) {
      Start-Sleep -Milliseconds 1500
      try { Invoke-WebRequest -Uri $m.preview -Headers $ua -OutFile $out -UseBasicParsing -TimeoutSec 120 } catch { "failed $id"; continue }
    }
    $all = @($all | Where-Object { $_.id -ne $id }) + $m
    $all | ConvertTo-Json -Depth 3 | Out-File -Encoding utf8 $licFile     # saved after every item
    "{0} {1} -> {2} ({3} KB)" -f $id, $m.license, $m.title, [math]::Round((Get-Item $out).Length / 1KB)
  }
}
