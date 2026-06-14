# tests/source-trust-verify.ps1
# Build-35: source-trust hardening. PS mirror of lib/sourceTrust.js (no Node on
# this box, per standing project note). The JS module is data-driven (domain
# lists + numeric thresholds) precisely so this mirror can be faithful.
#
# Covers: classifyDomain tiers (official / reputable / reference / forum /
# prediction / unknown), the prediction red-flag dominating list membership and
# path tokens, recencyBucket boundaries, and the assessResults verdict flags
# (singleWeakSource / predictionHeavy / allStale / mixedTrust) + ranking order
# (strong source floats to [1], prediction sinks) + the empty -> count:0 guard.

$ErrorActionPreference = "Stop"
$pass = 0
$fail = 0
function Test-True($name, $cond) {
  if ($cond) { $script:pass++; Write-Host "PASS: $name" }
  else       { $script:fail++; Write-Host "FAIL: $name" -ForegroundColor Red }
}

# ── mirror of the JS data lists ──────────────────────────────────────────────
$OFFICIAL  = @("fifa.com","uefa.com","olympics.com","olympic.org","nasa.gov","esa.int","who.int","un.org","europa.eu","premierleague.com","nba.com","fiba.basketball","icc-cricket.com")
$REPUTABLE = @("reuters.com","apnews.com","bbc.com","bbc.co.uk","nytimes.com","theguardian.com","aljazeera.com","espn.com","espn.co.uk","bloomberg.com","ft.com","wsj.com","cnn.com","npr.org","washingtonpost.com","economist.com","skysports.com","goal.com","arabnews.com","thenationalnews.com","spa.gov.sa")
$REFERENCE = @("wikipedia.org","britannica.com")
$FORUM     = @("reddit.com","quora.com","fandom.com","medium.com","stackexchange.com","stackoverflow.com","answers.com","wikihow.com","facebook.com","twitter.com","x.com","instagram.com","tiktok.com")
$PREDICT   = @("predict","betting","bet365","odds","forebet","tipster","tips","forecast","preview","wager","bookmaker","punter","accumulator")
$WEIGHT = @{ official=5; reputable=4; reference=3; unknown=2; forum=1; prediction=0 }

function Get-Domain([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return "" }
  $h = $url.Trim() -replace '^[a-zA-Z]+://',''
  $h = ($h -split '[/?#]')[0]
  $h = ($h -split '@')[-1]
  $h = ($h -split ':')[0]
  $h = $h.ToLower() -replace '^www\.',''
  return $h
}
function Get-Path([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return "" }
  $ns = $url.Trim() -replace '^[a-zA-Z]+://',''
  $i = $ns.IndexOf('/')
  if ($i -lt 0) { return "" }
  return $ns.Substring($i).ToLower()
}
function Host-Matches([string]$hostName, $list) {
  foreach ($d in $list) { if ($hostName -eq $d -or $hostName.EndsWith("." + $d)) { return $true } }
  return $false
}
function Classify([string]$url) {
  $domain = Get-Domain $url
  if ($domain -eq "") { return @{ tier="unknown"; weight=$WEIGHT.unknown; domain="" } }
  $hay = $domain + " " + (Get-Path $url)
  foreach ($t in $PREDICT) { if ($hay.Contains($t)) { return @{ tier="prediction"; weight=0; domain=$domain } } }
  $tld = ($domain -split '\.')[-1]
  if ($tld -eq "gov" -or $tld -eq "edu" -or $tld -eq "int" -or (Host-Matches $domain $OFFICIAL)) { return @{ tier="official"; weight=5; domain=$domain } }
  if (Host-Matches $domain $REPUTABLE) { return @{ tier="reputable"; weight=4; domain=$domain } }
  if (Host-Matches $domain $REFERENCE) { return @{ tier="reference"; weight=3; domain=$domain } }
  if (Host-Matches $domain $FORUM)     { return @{ tier="forum"; weight=1; domain=$domain } }
  return @{ tier="unknown"; weight=2; domain=$domain }
}

function Recency-Bucket($publishedDate, [datetime]$now) {
  if ([string]::IsNullOrWhiteSpace($publishedDate)) { return @{ bucket="unknown"; ageDays=$null } }
  $t = [datetime]::MinValue
  if (-not [datetime]::TryParse($publishedDate, [ref]$t)) { return @{ bucket="unknown"; ageDays=$null } }
  $age = [math]::Max(0, [math]::Round(($now - $t).TotalDays))
  if     ($age -le 3)   { $b = "fresh" }
  elseif ($age -le 30)  { $b = "recent" }
  elseif ($age -le 365) { $b = "dated" }
  else                  { $b = "stale" }
  return @{ bucket=$b; ageDays=$age }
}
$FRESH_RANK = @{ fresh=4; recent=3; unknown=2; dated=1; stale=0 }

function Assess($results, [datetime]$now) {
  if ($null -eq $results -or $results.Count -eq 0) {
    return @{ ranked=@(); verdict=@{ count=0; singleWeakSource=$false; predictionHeavy=$false; allStale=$false; mixedTrust=$false } }
  }
  $ann = @()
  $idx = 0
  foreach ($r in $results) {
    $c = Classify $r.url
    $rec = Recency-Bucket $r.published_date $now
    $score = 0.0; if ($r.score -is [double] -or $r.score -is [int]) { $score = [double]$r.score }
    $ann += [pscustomobject]@{ title=$r.title; url=$r.url; idx=$idx; tier=$c.tier; weight=$c.weight; domain=$c.domain; bucket=$rec.bucket; ageDays=$rec.ageDays; score=$score }
    $idx++
  }
  $ranked = $ann | Sort-Object `
    @{ Expression = { -$_.weight } }, `
    @{ Expression = { -1 * $FRESH_RANK[$_.bucket] } }, `
    @{ Expression = { -$_.score } }, `
    @{ Expression = { $_.idx } }
  $ranked = @($ranked)
  $weights = $ranked | ForEach-Object { $_.weight }
  $topWeight = $ranked[0].weight
  $topTier   = $ranked[0].tier
  $datedWorse = @($ranked | Where-Object { $_.bucket -eq "dated" -or $_.bucket -eq "stale" })
  $anyFresh   = @($ranked | Where-Object { $_.bucket -eq "fresh" -or $_.bucket -eq "recent" }).Count -gt 0
  $allWeak    = ($weights | Where-Object { $_ -gt 1 }).Count -eq 0
  $top2pred   = @($ranked | Select-Object -First 2 | Where-Object { $_.tier -eq "prediction" }).Count -gt 0
  $anyPred    = @($ranked | Where-Object { $_.tier -eq "prediction" }).Count -gt 0
  $allStale   = ($datedWorse.Count -gt 0) -and (@($datedWorse | Where-Object { $_.bucket -ne "stale" }).Count -eq 0) -and (-not $anyFresh)
  $verdict = @{
    count            = $ranked.Count
    topTier          = $topTier
    topWeight        = $topWeight
    singleWeakSource = ($ranked.Count -eq 1) -or $allWeak
    predictionHeavy  = $top2pred
    allStale         = $allStale
    mixedTrust       = ($topWeight -ge 4) -and $anyPred
  }
  return @{ ranked=$ranked; verdict=$verdict }
}

function New-Res($url, $score, $date) { return [pscustomobject]@{ title="t"; url=$url; score=$score; published_date=$date } }
$NOW = [datetime]"2026-06-15T12:00:00Z"

# ── classifyDomain tiers ─────────────────────────────────────────────────────
Test-True "reuters -> reputable"            ((Classify "https://www.reuters.com/world/x").tier -eq "reputable")
Test-True "espn subpath -> reputable"       ((Classify "https://espn.com/soccer/report/123").tier -eq "reputable")
Test-True ".gov -> official"                ((Classify "https://nasa.gov/news").tier -eq "official")
Test-True "fifa.com allowlist -> official"  ((Classify "https://www.fifa.com/match/456").tier -eq "official")
Test-True "wikipedia -> reference"          ((Classify "https://en.wikipedia.org/wiki/X").tier -eq "reference")
Test-True "reddit -> forum"                 ((Classify "https://www.reddit.com/r/soccer/abc").tier -eq "forum")
Test-True "fandom subdomain -> forum"       ((Classify "https://football.fandom.com/wiki/X").tier -eq "forum")
Test-True "unknown blog -> unknown"         ((Classify "https://some-random-blog.net/post").tier -eq "unknown")
Test-True "forebet -> prediction"           ((Classify "https://www.forebet.com/en/predictions").tier -eq "prediction")
Test-True "betting token in host -> prediction" ((Classify "https://livebetting.example.com/x").tier -eq "prediction")
# prediction red flag DOMINATES list membership / path
Test-True "espn /preview/ path -> prediction (over-read guard)" ((Classify "https://espn.com/soccer/preview/brazil-morocco").tier -eq "prediction")
Test-True "reputable /predictions/ path -> prediction" ((Classify "https://skysports.com/football/predictions/123").tier -eq "prediction")

# ── recencyBucket boundaries ─────────────────────────────────────────────────
Test-True "today -> fresh"   ((Recency-Bucket "2026-06-14" $NOW).bucket -eq "fresh")
Test-True "15 days -> recent" ((Recency-Bucket "2026-05-31" $NOW).bucket -eq "recent")
Test-True "100 days -> dated" ((Recency-Bucket "2026-03-07" $NOW).bucket -eq "dated")
Test-True "2 years -> stale"  ((Recency-Bucket "2024-06-15" $NOW).bucket -eq "stale")
Test-True "no date -> unknown" ((Recency-Bucket $null $NOW).bucket -eq "unknown")
Test-True "garbage date -> unknown" ((Recency-Bucket "not-a-date" $NOW).bucket -eq "unknown")

# ── ranking: strongest source floats to [1], prediction sinks ────────────────
$mixed = @( (New-Res "https://forebet.com/predictions/x" 0.99 $null), (New-Res "https://reuters.com/a" 0.10 $null), (New-Res "https://some-blog.net/b" 0.50 $null) )
$a = Assess $mixed $NOW
Test-True "ranking: reputable is [1] despite lowest tavily score" ($a.ranked[0].tier -eq "reputable")
Test-True "ranking: prediction sinks to last"                     ($a.ranked[-1].tier -eq "prediction")

# ── verdict flags ────────────────────────────────────────────────────────────
$single = @( (New-Res "https://some-blog.net/x" 0.9 $null) )
Test-True "single result -> singleWeakSource" ((Assess $single $NOW).verdict.singleWeakSource)

$allWeak = @( (New-Res "https://reddit.com/r/x" 0.9 $null), (New-Res "https://forebet.com/p" 0.8 $null) )
Test-True "all forum/prediction -> singleWeakSource" ((Assess $allWeak $NOW).verdict.singleWeakSource)

$strong2 = @( (New-Res "https://reuters.com/a" 0.9 $null), (New-Res "https://bbc.com/b" 0.8 $null) )
Test-True "two strong sources -> NOT singleWeakSource" (-not (Assess $strong2 $NOW).verdict.singleWeakSource)

$predTop = @( (New-Res "https://forebet.com/p" 0.9 $null), (New-Res "https://some-blog.net/b" 0.5 $null) )
Test-True "prediction in top 2 -> predictionHeavy" ((Assess $predTop $NOW).verdict.predictionHeavy)

$mixV = Assess $mixed $NOW
Test-True "reputable + prediction present -> mixedTrust" ($mixV.verdict.mixedTrust)
Test-True "mixed: reputable [1] means NOT predictionHeavy" (-not $mixV.verdict.predictionHeavy)

$stale = @( (New-Res "https://reuters.com/old" 0.9 "2023-01-01"), (New-Res "https://bbc.com/old" 0.8 "2022-05-01") )
Test-True "all sources >1yr -> allStale" ((Assess $stale $NOW).verdict.allStale)
$freshMix = @( (New-Res "https://reuters.com/old" 0.9 "2023-01-01"), (New-Res "https://bbc.com/new" 0.8 "2026-06-14") )
Test-True "one fresh present -> NOT allStale" (-not (Assess $freshMix $NOW).verdict.allStale)

# ── empty / total-function guard ─────────────────────────────────────────────
Test-True "empty results -> count 0" ((Assess @() $NOW).verdict.count -eq 0)
Test-True "null results -> count 0"  ((Assess $null $NOW).verdict.count -eq 0)

Write-Host ""
Write-Host "=== source-trust-verify.ps1 (Build-35) ==="
Write-Host "PASS: $pass  FAIL: $fail"
if ($fail -gt 0) { exit 1 }
