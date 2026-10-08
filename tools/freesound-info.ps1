# Collects public metadata for Freesound sounds (title, licence, format, rating, downloads, HQ preview URL).
# Usage: powershell -File tools/freesound-info.ps1 -Ids 272160,272159 [-Out file.json]
param([string[]]$Ids, [string]$Out)
$ProgressPreference = 'SilentlyContinue'
$ua = @{ 'User-Agent' = 'Mozilla/5.0 (NightShift asset research)' }
$rows = @()
foreach ($id in ($Ids -join ',').Split(',')) {
  if (-not $id) { continue }
  try {
    $r = Invoke-WebRequest -Uri "https://freesound.org/s/$id/" -Headers $ua -UseBasicParsing -MaximumRedirection 5
    $h = $r.Content
    $title = ([regex]::Match($h, '<title>Freesound - (.*?)</title>')).Groups[1].Value
    $mp3 = ([regex]::Match($h, 'https://cdn\.freesound\.org/previews/[^"'' ]+?-hq\.mp3')).Value
    $lic = if ($h -match 'publicdomain/zero|Creative Commons 0') { 'CC0' } elseif ($h -match 'licenses/by-nc') { 'CC-BY-NC' } elseif ($h -match 'licenses/by/') { 'CC-BY' } else { '?' }
    $dur = ([regex]::Match($h, '(\d+:\d+\.\d+)')).Groups[1].Value
    $sr = ([regex]::Match($h, '(\d+) ?Hz')).Groups[1].Value
    $fmt = ([regex]::Match($h, '(?i)>(wav|flac|aiff|mp3|ogg)<')).Groups[1].Value
    $dl = ([regex]::Match($h, '(\d[\d,]*)\s*downloads?')).Groups[1].Value
    $rating = ([regex]::Match($h, '(?s)avg-rating[^>]*>\s*([\d.]+)')).Groups[1].Value
    $desc = ([regex]::Match($h, '(?s)<meta name="description" content="(.*?)"')).Groups[1].Value
    $rows += [pscustomobject]@{ id = $id; title = $title; lic = $lic; fmt = $fmt; sr = $sr; dur = $dur; dl = $dl; rating = $rating; mp3 = $mp3; desc = $desc.Substring(0, [math]::Min(140, $desc.Length)) }
  } catch { $rows += [pscustomobject]@{ id = $id; title = 'ERR ' + $_.Exception.Message } }
}
if ($Out) { $rows | ConvertTo-Json -Depth 3 | Out-File -Encoding utf8 $Out }
$rows | Format-Table id, lic, fmt, sr, dur, dl, title -AutoSize | Out-String -Width 250
