# tests/build162_resilience.test.ps1 -- Build-162 provider resilience ship gate.
# Live bug (2026-06-29): "all providers failed" -- Google was down (gemini+gemini2 are
# both Google), AND groq 413'd ("Request too large", conversation-history bloat), AND
# cerebras/mistral were cooling down. Fix: trimContents() drops the OLDEST turns before
# any provider call so a bloated session can't 413 the non-Google fallbacks. Free-default
# doctrine kept: no paid provider added; non-Google free fallbacks already exist.
# PS-5.1: ASCII-only. Mirrors trimContents() drop-oldest/keep-latest/leading-model logic.

$pass = 0; $fail = 0
function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}

$llm = Get-Content -Raw (Join-Path $PSScriptRoot "..\lib\llm.js")

# ---------------------------------------------------------------------------
# 1. STATIC guards
# ---------------------------------------------------------------------------
Write-Host "`n-- Static source guards --" -ForegroundColor Cyan
CheckTrue "trimContents() defined"                 ($llm.Contains('function trimContents('))
CheckTrue "LLM_MAX_CONTENT_CHARS env-tunable"      ($llm.Contains('LLM_MAX_CONTENT_CHARS'))
$applied = ([regex]::Matches($llm, 'contents = trimContents\(contents\)')).Count
CheckTrue "trim applied in BOTH generate + generateStream" ($applied -ge 2)
CheckTrue "drops leading model turn (Gemini needs leading user)" ($llm.Contains("kept[0].role === ""model"""))
CheckTrue "always keeps >=1 (the latest turn)"     ($llm.Contains('kept.length >= 1'))

# ---------------------------------------------------------------------------
# 2. Behavioral mirror of trimContents (drop oldest, keep latest, fix leading-model)
# ---------------------------------------------------------------------------
function TrimContents($contents, [int]$cap) {
  $arr = @($contents)
  if ($arr.Count -le 1) { return $arr }
  $total = 0
  $kept = New-Object System.Collections.ArrayList
  for ($i = $arr.Count - 1; $i -ge 0; $i--) {
    $len = [int]$arr[$i].len
    if ($kept.Count -ge 1 -and ($total + $len) -gt $cap) { break }
    $total += $len
    [void]$kept.Insert(0, $arr[$i])
  }
  while ($kept.Count -gt 1 -and $kept[0].role -eq 'model') { [void]$kept.RemoveAt(0) }
  return ,($kept.ToArray())
}
function Msg([string]$role, [int]$len) { return [pscustomobject]@{ role=$role; len=$len } }

Write-Host "`n-- trimContents behavioral mirror --" -ForegroundColor Cyan

# Small session well under cap -> unchanged
$small = @((Msg 'user' 50), (Msg 'model' 50), (Msg 'user' 50))
$r1 = TrimContents $small 32000
CheckTrue "small session unchanged (3 kept)" (@($r1).Count -eq 3)

# Oversized -> drops oldest, keeps the most recent that fit
$big = @((Msg 'user' 100), (Msg 'model' 100), (Msg 'user' 100), (Msg 'model' 100), (Msg 'user' 100))
$r2 = TrimContents $big 250
CheckTrue "oversized was trimmed (fewer than 5)"             (@($r2).Count -lt 5)
CheckTrue "trimmed result starts with a user turn (Gemini-valid)" ($r2[0].role -eq 'user')
CheckTrue "latest turn always retained"                      ($r2[$r2.Count-1].role -eq 'user')

# Single huge latest turn -> still kept (never drop the current turn)
$huge = @((Msg 'user' 100), (Msg 'user' 5000))
$r3 = TrimContents $huge 250
CheckTrue "keeps the latest turn even if it alone exceeds cap" (@($r3).Count -eq 1 -and $r3[0].len -eq 5000)

# Leading 'model' exposed by trim -> dropped (Gemini requires leading user)
$lead = @((Msg 'model' 50), (Msg 'user' 50), (Msg 'model' 50), (Msg 'user' 50))
$r4 = TrimContents $lead 100000
CheckTrue "leading model turn dropped"  ($r4[0].role -eq 'user')
CheckTrue "trailing turns preserved"    ($r4[$r4.Count-1].role -eq 'user')

# Single-turn input -> returned as-is (guard)
$one = @((Msg 'user' 99999))
$r5 = TrimContents $one 10
CheckTrue "single turn returned as-is" (@($r5).Count -eq 1)

Write-Host "`n================ B-162 RESILIENCE RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
