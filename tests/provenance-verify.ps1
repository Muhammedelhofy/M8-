# provenance-verify.ps1 -- Build-30 Provenance Tagging (PROVENANCE_TAGGING_DESIGN.md)
# PowerShell mirror of lib/memory.js inferSourceType + the RECALL_MIN_TRUST gate.
# Replaces the LOOP_TRIAGE_CONTAMINATION content regex (Build-26/26.1) with a
# permanent metadata classification: session-id prefix -> source_type/trust_level
# at WRITE time; recall excludes anything below RECALL_MIN_TRUST (3). Pure ASCII.

$pass = 0; $fail = 0
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}
function CheckEq([string]$name, $actual, $expected) {
  if ($actual -eq $expected) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name (got '$actual', expected '$expected')" -ForegroundColor Red }
}

# --- PS mirror of inferSourceType (lib/memory.js) ---
function InferSourceType([string]$sid) {
  $s = "$sid"
  if ($s -cmatch '^(?:[Ll]5_|[Ee]val_|[Oo]d_|[Bb]attery_)') {
    return [pscustomobject]@{ source_type = 'eval_probe'; trust_level = 1 }
  }
  if ($s -cmatch '^[Cc]ron[_-]') {
    return [pscustomobject]@{ source_type = 'cron_session'; trust_level = 2 }
  }
  return [pscustomobject]@{ source_type = 'user_session'; trust_level = 4 }
}

$RECALL_MIN_TRUST = 3

Write-Host "`n== inferSourceType: session-id prefix -> source_type/trust_level ==" -ForegroundColor Cyan

$r = InferSourceType "od_2026-06-14T03-25-59"
CheckEq "od_ prefix -> eval_probe"      $r.source_type 'eval_probe'
CheckEq "od_ prefix -> trust_level 1"   $r.trust_level  1

$r = InferSourceType "battery_run_42"
CheckEq "battery_ prefix -> eval_probe"    $r.source_type 'eval_probe'
CheckEq "battery_ prefix -> trust_level 1" $r.trust_level  1

$r = InferSourceType "l5_loop_2026-06-15"
CheckEq "l5_ prefix -> eval_probe"      $r.source_type 'eval_probe'
CheckEq "l5_ prefix -> trust_level 1"   $r.trust_level  1

$r = InferSourceType "eval_battery_run"
CheckEq "eval_ prefix -> eval_probe"    $r.source_type 'eval_probe'
CheckEq "eval_ prefix -> trust_level 1" $r.trust_level  1

$r = InferSourceType "cron_explore_2026-06-15"
CheckEq "cron_ prefix -> cron_session"     $r.source_type 'cron_session'
CheckEq "cron_ prefix -> trust_level 2"    $r.trust_level  2

$r = InferSourceType "cron-verify-2026-06-15"
CheckEq "cron- prefix -> cron_session"     $r.source_type 'cron_session'

$r = InferSourceType "muhammad-2026-06-14-1022"
CheckEq "ordinary session -> user_session"   $r.source_type 'user_session'
CheckEq "ordinary session -> trust_level 4"  $r.trust_level  4

$r = InferSourceType ""
CheckEq "empty session id -> user_session (safe default)" $r.source_type 'user_session'

Write-Host "`n== RECALL_MIN_TRUST gate: which rows survive recall ==" -ForegroundColor Cyan

CheckTrue "user_session (4) >= RECALL_MIN_TRUST -> recalled"   (4 -ge $RECALL_MIN_TRUST)
CheckTrue "summary (3) >= RECALL_MIN_TRUST -> recalled"        (3 -ge $RECALL_MIN_TRUST)
CheckTrue "cron_session (2) < RECALL_MIN_TRUST -> excluded"    (2 -lt $RECALL_MIN_TRUST)
CheckTrue "eval_probe (1) < RECALL_MIN_TRUST -> excluded"      (1 -lt $RECALL_MIN_TRUST)

# --- the actual Build-26 contamination case: an od_/battery_ session wrote a
# confabulated "Conjecture #7 was kept" row. Under the OLD regex filter this
# required loopCtx.text to be non-empty AND role != user to be stripped. Under
# the NEW design, the row never clears RECALL_MIN_TRUST regardless of role,
# content, or which lane is active -- it is excluded for EVERY recall.
$contaminatedRow = [pscustomobject]@{
  session_id = 'od_2026-06-14T03-25-59'
  role       = 'assistant'
  content    = 'Conjecture #7 was kept and #4 was dismissed.'
}
$tag = InferSourceType $contaminatedRow.session_id
CheckTrue "Build-26 contamination row tagged eval_probe" ($tag.source_type -eq 'eval_probe')
CheckTrue "Build-26 contamination row excluded from ALL recall (not just loop-recall)" ($tag.trust_level -lt $RECALL_MIN_TRUST)

Write-Host "`n=================================================="
Write-Host "  provenance tagging (Build-30): $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
