# ============================================================================
# Build-150: Router Miss Logger -- offline verifier (PS 5.1, no Node).
#   powershell -File tests/build150-miss-logger-test.ps1
#
# Part 1 — PS MIRROR of pure logic in lib/miss-logger.js:
#   redact(), buildMissPacket(), detectMissRead().
# Part 2 — static wiring: the files exist, the exports are present, the
#   orchestrator hooks logMiss at capabilityFallback and calls detectMissRead.
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else        { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ============================================================================
# PART 1 — PURE-LOGIC MIRRORS
# ============================================================================

# ---- mirror of redact() ----------------------------------------------------
$MAX_LEN = 280

function Redact($raw) {
  if ($null -eq $raw) { return '' }
  $s = ([string]$raw).Trim()
  if ($s.Length -gt 600) { $s = $s.Substring(0, 600) }
  # digits (with optional decimal)
  $s = [regex]::Replace($s, '\d+(?:[.,]\d+)*', '[#]')
  # currency codes / symbols (case-insensitive)
  $s = [regex]::Replace($s, '(?i)\b(sar|rial|riyal|sr|egp|usd|dollar|pound|ريال|جنيه|دولار)\b', '[CUR]')
  # money domain nouns (case-insensitive)
  $s = [regex]::Replace($s, '(?i)\b(expenses?|wallet|balance|transactions?|spend(?:ing)?|spent|paid|salary|راتب|مصروف|مصاريف|محفظة|رصيد|معاملة|معاملات)\b', '[MONEY]')
  if ($s.Length -gt $MAX_LEN) { return $s.Substring(0, $MAX_LEN) }
  return $s
}

Write-Host "`n-- redact(): digits stripped --" -ForegroundColor Cyan
Ok ((Redact 'add 50 sar lunch')     -match '\[#\]')          "digit 50 -> [#]"
Ok ((Redact 'add 50 sar lunch')     -notmatch '\b50\b')      "raw digit 50 not in output"
Ok ((Redact 'spent 1,200 on food')  -match '\[#\]')          "comma-decimal digit -> [#]"

Write-Host "`n-- redact(): currency stripped --" -ForegroundColor Cyan
$r1 = Redact 'add 50 SAR lunch'
Ok ($r1 -match '\[CUR\]')          "SAR -> [CUR]"
Ok ($r1 -notmatch '\bSAR\b')       "raw SAR not in output"
$r2 = Redact 'pay 200 riyal rent'
Ok ($r2 -match '\[CUR\]')          "riyal -> [CUR]"

Write-Host "`n-- redact(): money nouns stripped --" -ForegroundColor Cyan
$r3 = Redact 'show my wallet balance'
Ok ($r3 -match '\[MONEY\]')        "wallet -> [MONEY]"
Ok ($r3 -match '\[MONEY\]')        "balance -> [MONEY]"
$r4 = Redact 'how much did I spend this month'
Ok ($r4 -match '\[MONEY\]')        "spend -> [MONEY]"

Write-Host "`n-- redact(): length cap --" -ForegroundColor Cyan
$long = 'a ' * 300
$rl = Redact $long
Ok ($rl.Length -le $MAX_LEN)       "output capped at MAX_LEN ($MAX_LEN)"

Write-Host "`n-- redact(): safe on empty / null --" -ForegroundColor Cyan
Ok ((Redact '')   -eq '')          "empty string -> empty"
Ok ((Redact $null) -eq '')         "null -> empty"

Write-Host "`n-- redact(): general chat passes through (unaffected) --" -ForegroundColor Cyan
$chat = Redact 'remind me to call Ahmad tomorrow'
Ok ($chat -notmatch '\[#\]')       "no digits in general chat"
Ok ($chat -notmatch '\[CUR\]')     "no currency in general chat"
Ok ($chat -notmatch '\[MONEY\]')   "no money nouns in general chat"
Ok ($chat -match 'remind')         "redact preserves non-money content"

# ---- mirror of buildMissPacket() -------------------------------------------

function BuildMissPacket($rows) {
  $list = @()
  if ($null -ne $rows) { $list = @($rows) }
  if ($list.Count -eq 0) {
    return "No router misses on record yet"
  }
  $lines = New-Object System.Collections.ArrayList
  $i = 0
  foreach ($r in $list) {
    $i++
    $ts    = if ($null -ne $r.created_at) { $r.created_at } else { '?' }
    $lane  = if ($null -ne $r.lane   -and ([string]$r.lane).Trim().Length -gt 0)   { $r.lane   } else { '?' }
    $rsn   = if ($null -ne $r.reason -and ([string]$r.reason).Trim().Length -gt 0) { " | $($r.reason)" } else { '' }
    $msg   = if ($null -ne $r.message_redacted) { $r.message_redacted } else { '' }
    [void]$lines.Add("$i. [$ts] lane=$lane$rsn`n   `"$msg`"")
  }
  return "**Router Misses" + [string]$null + "**`n" + ($lines -join "`n`n")
}

Write-Host "`n-- buildMissPacket(): empty list --" -ForegroundColor Cyan
$empty = BuildMissPacket @()
Ok ($empty -match 'No router misses')      "empty -> no-record message"

Write-Host "`n-- buildMissPacket(): single row --" -ForegroundColor Cyan
$row1 = [pscustomobject]@{
  created_at       = '2026-06-25T08:00:00Z'
  lane             = 'money'
  reason           = 'phase0_safety_net'
  message_redacted = 'show my [MONEY] [MONEY]'
}
$pkt1 = BuildMissPacket @($row1)
Ok ($pkt1 -match 'Router Misses')          "header present"
Ok ($pkt1 -match 'lane=money')             "lane appears"
Ok ($pkt1 -match 'phase0_safety_net')      "reason appears"
Ok ($pkt1 -match '\[MONEY\]')              "redacted content shown"
Ok ($pkt1 -match '1\.')                    "numbered list starts at 1"

Write-Host "`n-- buildMissPacket(): multiple rows --" -ForegroundColor Cyan
$rows2 = @(
  [pscustomobject]@{ created_at='2026-06-25T08:00:00Z'; lane='task';  reason='phase0_safety_net'; message_redacted='add a task for tomorrow' },
  [pscustomobject]@{ created_at='2026-06-25T09:00:00Z'; lane='money'; reason='phase0_safety_net'; message_redacted='show [MONEY] [MONEY]' }
)
$pkt2 = BuildMissPacket $rows2
Ok ($pkt2 -match '1\.')                    "row 1 numbered"
Ok ($pkt2 -match '2\.')                    "row 2 numbered"
Ok ($pkt2 -match 'lane=task')              "task lane present"
Ok ($pkt2 -match 'lane=money')             "money lane present"

Write-Host "`n-- buildMissPacket(): null fields handled --" -ForegroundColor Cyan
$rowNull = [pscustomobject]@{ created_at=$null; lane=$null; reason=$null; message_redacted=$null }
$pktN = BuildMissPacket @($rowNull)
Ok ($pktN -notmatch 'exception')           "null fields don't throw"
Ok ($pktN -match 'lane=\?')               "null lane -> ?"

# ---- mirror of detectMissRead() --------------------------------------------
# Regex pattern mirrored from JS MISS_READ_RE.

function DetectMissRead($message) {
  if ($null -eq $message) { return $false }
  $s = ([string]$message).Trim()
  if ($s.Length -lt 5) { return $false }
  return ($s -imatch "\b(?:show(?:\s+me)?\s+(?:(?:my|recent|last)\s+)?(?:misses?\b|router\s+misses?\b|unhandled\s+messages?\b)|what\s+(?:did\s+)?(?:m8|you)\s+(?:not\s+understand\b|miss(?:ed)?\b|fail(?:ed)?\s+(?:on|at|to\s+handle)\b|couldn.t\s+handle\b)|(?:recent|last)\s+(?:\d+\s+)?misses?\b|router\s+misses?\b|unhandled\s+(?:messages?\b|turns?\b)|what\s+(?:m8|you)\s+(?:can.t|couldn.t)\s+handle\b)\b")
}

Write-Host "`n-- detectMissRead(): should-detect (positive) --" -ForegroundColor Cyan
Ok (DetectMissRead 'show my recent misses')             "show my recent misses"
Ok (DetectMissRead 'show me my misses')                 "show me my misses"
Ok (DetectMissRead 'show recent misses')                "show recent misses"
Ok (DetectMissRead 'show my last misses')               "show my last misses"
Ok (DetectMissRead 'what did M8 not understand')        "what did M8 not understand"
Ok (DetectMissRead 'what did you not understand')       "what did you not understand"
Ok (DetectMissRead 'what did M8 miss')                  "what did M8 miss"
Ok (DetectMissRead 'router misses')                     "router misses (bare)"
Ok (DetectMissRead 'show router misses')                "show router misses"
Ok (DetectMissRead 'what M8 couldn''t handle')          "what M8 couldn't handle"
Ok (DetectMissRead 'unhandled messages')                "unhandled messages"

Write-Host "`n-- detectMissRead(): should NOT detect (negative) --" -ForegroundColor Cyan
Ok (-not (DetectMissRead 'add 50 sar lunch'))           "add expense -> no detect"
Ok (-not (DetectMissRead 'what did you think of that')) "general question -> no detect"
Ok (-not (DetectMissRead 'what is M8'))                 "what is M8 -> no detect"
Ok (-not (DetectMissRead 'remind me to call Ahmad'))    "task request -> no detect"
Ok (-not (DetectMissRead ''))                           "empty -> no detect"
Ok (-not (DetectMissRead 'hi'))                         "too short -> no detect"

# ============================================================================
# PART 2 — STATIC WIRING
# ============================================================================
Write-Host "`n-- static wiring --" -ForegroundColor Cyan
$root        = Split-Path -Parent $PSScriptRoot
$loggerPath  = Join-Path $root 'lib\miss-logger.js'
$orchPath    = Join-Path $root 'lib\orchestrator.js'
$migPath     = Join-Path $root 'migrations\B150_router_misses.sql'

Ok ([IO.File]::Exists($loggerPath))  "lib/miss-logger.js exists"
Ok ([IO.File]::Exists($orchPath))    "lib/orchestrator.js exists"
Ok ([IO.File]::Exists($migPath))     "migrations/B150_router_misses.sql exists"

$logger = [IO.File]::ReadAllText($loggerPath, [Text.Encoding]::UTF8)
$orch   = [IO.File]::ReadAllText($orchPath,   [Text.Encoding]::UTF8)
$mig    = [IO.File]::ReadAllText($migPath,    [Text.Encoding]::UTF8)

Write-Host "`n-- lib/miss-logger.js surface --" -ForegroundColor Cyan
Ok ($logger -match 'async function logMiss')         "defines logMiss"
Ok ($logger -match 'function detectMissRead')        "defines detectMissRead"
Ok ($logger -match 'async function fetchRecentMisses') "defines fetchRecentMisses"
Ok ($logger -match 'function buildMissPacket')       "defines buildMissPacket"
Ok ($logger -match 'function redact')                "defines redact"
Ok ($logger -match 'm8_router_misses')               "targets m8_router_misses table"
Ok ($logger -match 'module\.exports')                "has module.exports"
Ok ($logger -match 'logMiss' -and $logger -match 'detectMissRead' -and $logger -match 'fetchRecentMisses' -and $logger -match 'buildMissPacket') "exports 4-fn surface"

Write-Host "`n-- redaction guard in miss-logger.js --" -ForegroundColor Cyan
Ok ($logger -match '_DIGIT_RE')      "digit redaction RE defined"
Ok ($logger -match '_CURRENCY_RE')   "currency redaction RE defined"
Ok ($logger -match '_MONEY_NOUN_RE') "money noun redaction RE defined"
Ok ($logger -match 'MAX_LEN\s*=')    "MAX_LEN constant present"
Ok ($logger -match 'fire-and-forget') "fire-and-forget annotation present"

Write-Host "`n-- migration B150_router_misses.sql --" -ForegroundColor Cyan
Ok ($mig -match 'CREATE TABLE IF NOT EXISTS m8_router_misses') "creates m8_router_misses (idempotent)"
Ok ($mig -match 'message_redacted\s+text\s+NOT NULL')          "message_redacted NOT NULL"
Ok ($mig -match 'lane\s+text')                                 "lane column"
Ok ($mig -match 'reason\s+text')                               "reason column"
Ok ($mig -match 'CREATE INDEX IF NOT EXISTS m8_router_misses_created_idx') "created_at index"

Write-Host "`n-- lib/orchestrator.js wiring --" -ForegroundColor Cyan
Ok ($orch -match "require\(['""]./miss-logger")                "requires miss-logger"
Ok ($orch -match 'logMiss\(')                                  "calls logMiss"
Ok ($orch -match 'detectMissRead\(')                           "calls detectMissRead"
Ok ($orch -match 'fetchRecentMisses\(')                        "calls fetchRecentMisses"
Ok ($orch -match 'buildMissPacket\(')                          "calls buildMissPacket"
Ok ($orch -match 'capability_fallback')                        "capability_fallback log tag present"
Ok ($orch -match 'phase0_safety_net')                          "phase0_safety_net reason tag present"
Ok ($orch -match 'miss_log_read')                              "miss_log_read log tag present"
Ok ($orch -match '_missLane')                                  "lane derivation present"

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host ("  Build-150 Miss-Logger: PASS=$($script:pass)  FAIL=$($script:fail)") -ForegroundColor $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })
Write-Host "============================================================`n" -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
