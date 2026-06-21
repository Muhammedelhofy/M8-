# consolidate-functions-verify.ps1
# PS 5.1 mirror test for the Hobby 12-function consolidation (no Node on host).
# Validates: api/ == 10 functions, 4 routers dispatch every fn, 12 handlers
# relocated + export a function, 12 dead endpoints gone, vercel.json rewrites map
# every old URL to a router fn, functions block references only real files, crons
# intact. The Vercel PREVIEW build is the live integration test; this is the gate.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot
$pass = 0; $fail = 0
function Ok($cond, $msg) {
  if ($cond) { Write-Host "  PASS  $msg" -ForegroundColor Green; $script:pass++ }
  else       { Write-Host "  FAIL  $msg" -ForegroundColor Red;   $script:fail++ }
}

Write-Host "`n== 1. api/ function count ==" -ForegroundColor Cyan
$apiFiles = Get-ChildItem (Join-Path $root "api") -Filter *.js -File | Select-Object -ExpandProperty Name | Sort-Object
Ok ($apiFiles.Count -eq 10) "exactly 10 api/*.js (Hobby cap = 12). Found $($apiFiles.Count): $($apiFiles -join ', ')"
$expectedApi = @("chat-stream.js","chat.js","cron-explore.js","cron-summarize.js","cron-verify.js","export.js","files.js","knowledge.js","morning-brief.js","ops.js") | Sort-Object
Ok (-not (Compare-Object $apiFiles $expectedApi)) "api/ set matches the expected 10 (6 kept + 4 routers)"

Write-Host "`n== 2. dead endpoints removed ==" -ForegroundColor Cyan
$dead = @("convert","knowledge-extract","knowledge-ingest","knowledge-decompose","summary-health","memory-health","seed-pack","graph-relabel","traces","pdf-to-text","nudge-history","ingest-book")
foreach ($d in $dead) { Ok (-not (Test-Path (Join-Path $root "api\$d.js"))) "api/$d.js deleted" }

Write-Host "`n== 3. handlers relocated to lib/handlers/ + export a function ==" -ForegroundColor Cyan
$handlers = @("ingest-full","ingest-extract-existing","knowledge-inventory","memory-consolidate","platform-sync","presign","upload-file","deck","fleet-export","health","loop-attest","notify-prefs")
foreach ($h in $handlers) {
  $p = Join-Path $root "lib\handlers\$h.js"
  $exists = Test-Path $p
  Ok $exists "lib/handlers/$h.js exists"
  if ($exists) {
    $txt = Get-Content $p -Raw
    Ok ($txt -match 'module\.exports\s*=\s*async') "  $h.js exports an async handler"
    Ok (-not ($txt -match 'require\("\.\./lib/')) "  $h.js has no stale ../lib/ require"
  }
}

Write-Host "`n== 4. routers dispatch every fn ==" -ForegroundColor Cyan
# router file -> required handler basenames + the fn case labels it must contain
$routers = @{
  "knowledge.js" = @{ handlers=@("ingest-full","ingest-extract-existing","knowledge-inventory","memory-consolidate","platform-sync"); fns=@("ingest-full","extract-existing","inventory","memory-consolidate","platform-sync") }
  "files.js"     = @{ handlers=@("presign","upload-file"); fns=@("presign","upload") }
  "export.js"    = @{ handlers=@("deck","fleet-export"); fns=@("deck","fleet") }
  "ops.js"       = @{ handlers=@("health","loop-attest","notify-prefs"); fns=@("health","loop-attest","notify-prefs") }
}
foreach ($r in $routers.Keys) {
  $txt = Get-Content (Join-Path $root "api\$r") -Raw
  Ok ($txt -match 'req\.query[^\n]*\bfn\b') "$r reads req.query.fn"
  foreach ($h in $routers[$r].handlers) { Ok ($txt -match [regex]::Escape("lib/handlers/$h")) "$r requires lib/handlers/$h" }
  foreach ($fn in $routers[$r].fns)      { Ok ($txt -match ('case\s*"' + [regex]::Escape($fn) + '"')) "$r has case `"$fn`"" }
}
# files.js must raise bodyParser for upload-file's inline base64 docs
$filesTxt = Get-Content (Join-Path $root "api\files.js") -Raw
Ok ($filesTxt -match 'bodyParser' -and $filesTxt -match '20mb') "files.js sets bodyParser 20mb"

Write-Host "`n== 5. vercel.json ==" -ForegroundColor Cyan
$vjPath = Join-Path $root "vercel.json"
$vj = $null
try { $vj = Get-Content $vjPath -Raw | ConvertFrom-Json } catch {}
Ok ($null -ne $vj) "vercel.json is valid JSON"
if ($vj) {
  # 5a. functions block references only files that exist
  $fnKeys = $vj.functions.PSObject.Properties.Name
  foreach ($k in $fnKeys) { Ok (Test-Path (Join-Path $root $k)) "functions['$k'] -> file exists" }
  Ok ($fnKeys.Count -le 12) "functions block lists <= 12 entries ($($fnKeys.Count))"
  # 5b. crons intact (4, correct paths) -- live core must not move
  $cronPaths = $vj.crons | ForEach-Object { $_.path } | Sort-Object
  $expectedCrons = @("/api/cron-explore","/api/cron-summarize","/api/cron-verify","/api/morning-brief") | Sort-Object
  Ok (-not (Compare-Object $cronPaths $expectedCrons)) "4 crons intact: $($cronPaths -join ', ')"
  foreach ($cp in $expectedCrons) { Ok (Test-Path (Join-Path $root ($cp.TrimStart('/') + '.js'))) "cron target $cp.js exists" }
  # 5c. every old URL rewrites to a router fn the router actually handles
  $idCount = 0
  foreach ($rw in $vj.rewrites) {
    if ($rw.source -eq "/api/(.*)") { $idCount++; continue }
    if ($rw.destination -match '^/api/([a-z]+)\?fn=([a-z-]+)$') {
      $routerFile = "$($Matches[1]).js"; $fn = $Matches[2]
      $rtxt = ""
      if (Test-Path (Join-Path $root "api\$routerFile")) { $rtxt = Get-Content (Join-Path $root "api\$routerFile") -Raw }
      Ok (($rtxt -ne "") -and ($rtxt -match ('case\s*"' + [regex]::Escape($fn) + '"'))) "rewrite $($rw.source) -> $routerFile handles fn=$fn"
    } else { Ok $false "rewrite destination parses: $($rw.destination)" }
  }
  Ok ($idCount -eq 1) "identity catch-all /api/(.*) present (count=$idCount)"
  # 5d. the 12 externally-callable old paths each have a rewrite
  $needSrc = @("/api/ingest-full","/api/ingest-extract-existing","/api/knowledge-inventory","/api/memory-consolidate","/api/platform-sync","/api/presign","/api/upload-file","/api/deck","/api/fleet-export","/api/health","/api/loop-attest","/api/notify-prefs")
  $haveSrc = $vj.rewrites | ForEach-Object { $_.source }
  foreach ($s in $needSrc) { Ok ($haveSrc -contains $s) "rewrite exists for $s" }
}

Write-Host "`n== 6. live frontend call sites still resolve ==" -ForegroundColor Cyan
# app.js calls these directly; each must be a kept file OR have a rewrite.
$appTxt = Get-Content (Join-Path $root "js\app.js") -Raw
$frontCalls = @("/api/chat","/api/chat-stream","/api/deck","/api/presign","/api/upload-file")
foreach ($c in $frontCalls) {
  $name = $c.Substring(5)
  $resolves = (Test-Path (Join-Path $root "api\$name.js")) -or ($vj.rewrites | Where-Object { $_.source -eq $c })
  Ok ([bool]$resolves) "app.js call $c resolves (kept file or rewrite)"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host ("  RESULT: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) {"Green"} else {"Red"})
Write-Host "========================================`n" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 }
