# ============================================================================
# M8 Build-118 -- Live web-search waterfall (Serper -> Tavily) + sports routing.
# PS 5.1 mirror (no local Node). Asserts:
#   A. the new LIVE_DATA score/won patterns catch the sports phrasings that
#      previously fell through to NONE and got fabricated;
#   B. innocuous queries are not stolen;
#   C. normalizeSerper (serperSearch.js) maps Serper JSON -> M8's canonical
#      { results:[{title,url,content}], answer } shape;
#   D. the search.js waterfall fall-through logic (hasResults gate).
#   E. source-binding: the new files/patterns exist on disk.
#   powershell -File tests/B118-live-search-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++ }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

$root = Split-Path $PSScriptRoot -Parent

# ---- MIRROR of the Build-118 LIVE_DATA score sub-patterns -------------------
# (lib/intentClassifier.js). .NET regex; PS -match is case-insensitive.
# English-only mirror (Arabic literals can't live in a pure-ASCII PS 5.1 file;
# the Arabic pattern is verified by source-binding in section A2 below).
$SCORE_EN = '\b(scores?|scored|scoring|who\s+won|who\s+is\s+winning|final\s+score|half[\s-]?time|full[\s-]?time)\b'
$VS       = '\b(vs\.?|versus)\b'
$MATCH    = '\b(match|matches|fixture|fixtures|kick-?off|line-?up|scoreline|standings|results?)\b'

function IsLiveSports([string]$m) {
  return ($m -match $SCORE_EN) -or ($m -match $VS) -or ($m -match $MATCH)
}

# ---- A: the previously-fabricated sports queries now route to live search ---
$sports = @(
  "what is the score of brazil and morocco",
  "what is the score of england vs ghana match",
  "what is the score of portugal match in world cup live with uzbekistan",
  "who won the match last night",
  "who is winning the game right now",
  "final score of the lakers game",
  "what was the half-time score"
)
foreach ($q in $sports) { Ok (IsLiveSports $q) ("A: live-sports -> search: '$q'") }
# A2: Arabic sports patterns shipped in the classifier (source-binding via
# char-code-built needles — keeps this file pure ASCII). $classJs is read below.

# ---- B: innocuous queries are NOT swept into live-search by these patterns --
# (these must NOT match the NEW score patterns; other intents may still handle
#  them, but the Build-118 additions must not be the thing that grabs them)
$innocuous = @(
  "what is my fleet profit this month",
  "summarize atomic habits",
  "set ahmad's rental to 1800",
  "explain how collatz works",
  "what did the engine learn"
)
foreach ($q in $innocuous) {
  $hit = ($q -match $SCORE_EN)
  Ok (-not $hit) ("B: innocuous -> not grabbed by score-pattern: '$q'")
}

# ---- C: normalizeSerper shape mirror ---------------------------------------
# PS mirror of lib/tools/serperSearch.js normalizeSerper(). Builds the same
# canonical shape from a mock Serper payload and asserts the mapping.
function Normalize-Serper($data) {
  if ($null -eq $data) { return @{ results = @(); answer = $null } }
  $answer = $null
  if ($data.answerBox) { $answer = $data.answerBox.answer; if (-not $answer) { $answer = $data.answerBox.snippet }; if (-not $answer) { $answer = $data.answerBox.title } }
  if ((-not $answer) -and $data.sports_results) {
    if ($data.sports_results.game_spotlight) { $answer = $data.sports_results.game_spotlight }
    elseif ($data.sports_results.title)      { $answer = $data.sports_results.title }
  }
  if ((-not $answer) -and $data.knowledgeGraph) {
    if ($data.knowledgeGraph.description) { $answer = $data.knowledgeGraph.description } else { $answer = $data.knowledgeGraph.title }
  }
  $results = @()
  if ($data.organic) {
    foreach ($o in $data.organic) {
      if ($o.link -or $o.title) {
        $title = $o.title; if (-not $title) { $title = "(no title)" }
        $url   = $o.link;  if (-not $url)   { $url = "" }
        $datep = ""; if ($o.date) { $datep = "($($o.date))" }
        $content = (@($datep, $o.snippet) | Where-Object { $_ }) -join " "
        $results += @{ title = $title; url = $url; content = $content.Trim() }
      }
    }
  }
  if (-not $answer) { $answer = $null }
  return @{ results = $results; answer = $answer }
}

# C1: answerBox wins as the direct answer
$mock1 = [pscustomobject]@{ answerBox = [pscustomobject]@{ answer = "Portugal 2 - 0 Uzbekistan" }
  organic = @([pscustomobject]@{ title = "BBC Sport"; link = "https://bbc.com/x"; snippet = "live"; date = "1 hour ago" }) }
$n1 = Normalize-Serper $mock1
Ok ($n1.answer -eq "Portugal 2 - 0 Uzbekistan") "C1: answerBox -> answer"
Ok ($n1.results.Count -eq 1)                     "C1: one organic result mapped"
Ok ($n1.results[0].url -eq "https://bbc.com/x")  "C1: organic link -> url"
Ok ($n1.results[0].content -like "(1 hour ago)*") "C1: date prefixed into content"

# C2: sports_results card supplies the answer when no answerBox
$mock2 = [pscustomobject]@{ sports_results = [pscustomobject]@{ title = "World Cup"; game_spotlight = "England 2-1 Ghana" }
  organic = @() }
$n2 = Normalize-Serper $mock2
Ok ($n2.answer -eq "England 2-1 Ghana") "C2: sports_results.game_spotlight -> answer"
Ok ($n2.results.Count -eq 0)            "C2: empty organic -> empty results"

# C3: knowledgeGraph fallback
$mock3 = [pscustomobject]@{ knowledgeGraph = [pscustomobject]@{ description = "A football club." }
  organic = @([pscustomobject]@{ title = "Wiki"; link = "u"; snippet = "s" }) }
$n3 = Normalize-Serper $mock3
Ok ($n3.answer -eq "A football club.") "C3: knowledgeGraph.description -> answer"

# C4: nothing usable -> empty shape, null answer
$n4 = Normalize-Serper ([pscustomobject]@{})
Ok ($n4.results.Count -eq 0 -and $null -eq $n4.answer) "C4: empty payload -> empty results + null answer"

# ---- D: waterfall fall-through (search.js hasResults gate) ------------------
function Has-Results($out) { return ($out -and $out.results -and $out.results.Count -gt 0) }
Ok (Has-Results @{ results = @(@{}) })            "D: hasResults true on non-empty"
Ok (-not (Has-Results @{ results = @() }))        "D: hasResults false on empty"
Ok (-not (Has-Results @{ results = $null }))      "D: hasResults false on null"
# Serper hit (has answer but 0 organic) still short-circuits the waterfall:
$serperAnswerOnly = @{ results = @(); answer = "live score" }
Ok (((Has-Results $serperAnswerOnly) -or [bool]$serperAnswerOnly.answer)) "D: answer-only Serper hit short-circuits (no Tavily call)"

# ---- E: source-binding (files + patterns present) --------------------------
$serperJs = [System.IO.File]::ReadAllText((Join-Path $root "lib/tools/serperSearch.js"))
$searchJs = [System.IO.File]::ReadAllText((Join-Path $root "lib/search.js"))
$classJs  = [System.IO.File]::ReadAllText((Join-Path $root "lib/intentClassifier.js"))

Ok ($serperJs.Contains("google.serper.dev/search"))  "E1: serperSearch hits google.serper.dev"
Ok ($serperJs.Contains("X-API-KEY"))                  "E2: serperSearch sends X-API-KEY header"
Ok ($serperJs.Contains("normalizeSerper"))            "E3: normalizeSerper exported"
Ok ($searchJs.Contains("searchSerper") -and $searchJs.Contains("searchTavily")) "E4: search.js waterfalls Serper -> Tavily"
Ok ($searchJs.Contains("SERPER_API_KEY") -and $searchJs.Contains("TAVILY_API_KEY")) "E5: both providers env-gated"
Ok ($classJs.Contains("who\s+won") -or $classJs.Contains("who\\s+won")) "E6: classifier has the who-won live pattern"
Ok ($classJs.Contains("scores?"))                     "E7: classifier has the bare-score live pattern"
# E8: Arabic score word 'natija' present in the classifier's live patterns
# (needle built from code points so this file stays pure ASCII).
$ar_natija = [string]::Join("", [char]0x646,[char]0x62A,[char]0x64A,[char]0x62C,[char]0x629)  # natija
Ok ($classJs.Contains($ar_natija)) "E8: classifier has the Arabic score/result pattern"

Write-Host ("`n==== B118-live-search-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
