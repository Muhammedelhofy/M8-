# M8 State Engine - PowerShell .NET-regex verification port
# Mirrors lib/stateEngine.js (no local node). Pure ASCII (PS 5.1 mangles a
# no-BOM UTF-8 .ps1 as ANSI). Run:  powershell -File tests/state-engine-verify.ps1

$ErrorActionPreference = 'Stop'
$opts = [Text.RegularExpressions.RegexOptions]::IgnoreCase

# -- ported regexes (verbatim sources from lib/stateEngine.js) -----------------
$GAME = @'
\b(chess|tic[\s-]?tac[\s-]?toe|checkers|draughts|connect\s*4|board|the\s+game|let'?s\s+play|your\s+move|my\s+move|i'?m\s+(?:white|black|x|o)\b|fen|gambit|opening|sicilian|defen[cs]e)\b
'@
$TALLY = @'
\b(count(?:er)?|tally|running\s+total|keep\s+track|the\s+total|score\s*keep|scorekeep)\b
'@
$INITIAL = @'
\b(?:start|begin|set|count(?:er)?|tally|initial(?:ize|ise)?)\b\s*(?:it\s+|the\s+\w+\s+)?(?:at|to|from|with|=)\s*(-?\d+(?:\.\d+)?)
'@
$OP = @'
\b(add|plus|increase(?:\s+by)?|subtract|minus|less|decrease(?:\s+by)?|take\s+away|times|multipl(?:y|ied)(?:\s+by)?|divide(?:\s+by)?|halve|double)\b\s*(-?\d+(?:\.\d+)?)?
'@
$ASK_TOTAL = @'
\b(what'?s|what\s+is|whats|give\s+me|tell\s+me|current|now)\b[^?]*\b(total|count|tally|number|score|sum)\b|\b(total|count|tally)\b\s*(?:now|\?|=)
'@
$CLAIM_FRAME = @'
\b(?:you\s+(?:played|moved|made\s+the\s+move|chose|told\s+me\s+you\s+played)|didn'?t\s+you\s+(?:play|move)|you\s+(?:said|claimed|told\s+me)(?:\s+(?:you'?d?\s+)?play(?:ed)?)?)\b
'@
$CHESS_MOVE = '^(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[KQRBN][a-h][1-8]|O-O(?:-O)?|0-0(?:-0)?|[a-h]x[a-h][1-8]|[a-h][1-8])$'
$NUM_CLAIM = '\b(?:was|is|=|equals?|equalled|:)\s*(-?\d+(?:\.\d+)?)\b'

$pass = 0; $fail = 0
function Check($name, $cond, $expected) {
  $ok = ($cond -eq $expected)
  if ($ok) { $script:pass++ } else { $script:fail++; Write-Host "  FAIL: $name (got '$cond', expected '$expected')" -ForegroundColor Red }
}

# -- ported logic --------------------------------------------------------------
function ApplyOp($total, $word, $n) {
  $w = $word.ToLower()
  if ($null -eq $n -and $w -eq 'double') { return $total * 2 }
  if ($null -eq $n -and $w -eq 'halve')  { return $total / 2 }
  if ($null -eq $n) { return $total }
  if ($w -match '^(add|plus|increase)') { return $total + $n }
  if ($w -match '^(subtract|minus|less|decrease|take)') { return $total - $n }
  if ($w -match '^(times|multipl)') { return $total * $n }
  if ($w -match '^divide') { if ($n -eq 0) { return $total } else { return $total / $n } }
  return $total
}
function ComputeTally($messages) {
  $total = $null; $steps = @()
  foreach ($text in $messages) {
    if ($null -eq $total) {
      $im = [regex]::Match($text, $INITIAL, $opts)
      if ($im.Success) { $total = [double]$im.Groups[1].Value; $steps += "start $total" }
    }
    if ($null -eq $total) { continue }
    foreach ($m in [regex]::Matches($text, $OP, $opts)) {
      $n = $null
      if ($m.Groups[2].Success) { $n = [double]$m.Groups[2].Value }
      $before = $total
      $total = ApplyOp $total $m.Groups[1].Value $n
      if (($total -ne $before) -or ($m.Groups[1].Value -match 'double|halve')) {
        $val = if ($null -ne $n) { "$n" } else { "" }
        $steps += ("{0} {1}" -f $m.Groups[1].Value.ToLower(), $val).Trim()
      }
    }
  }
  if ($null -eq $total) { return $null }
  return [pscustomobject]@{ total = [math]::Round([double]$total, 6); steps = $steps }
}
function CheckClaim($message, $botTexts) {
  $fm = [regex]::Match($message, $CLAIM_FRAME, $opts)
  if (-not $fm.Success) { return $null }
  $rest = $message.Substring($fm.Index + $fm.Length)
  $tm = [regex]::Match($rest, '^[^.?!;\n]{0,40}')
  $tail = $tm.Value
  $claimed = $null
  foreach ($tok in ($tail -split '[^A-Za-z0-9+#=-]+')) {
    if ($tok -and [regex]::IsMatch($tok, $CHESS_MOVE)) { $claimed = $tok; break }   # case-sensitive like JS
  }
  if ($null -eq $claimed) {
    $nm = [regex]::Match($tail, $NUM_CLAIM, $opts)
    if ($nm.Success) { $claimed = $nm.Groups[1].Value }
  }
  if ($null -eq $claimed) { return $null }
  $tokenRe = "(?:^|[^A-Za-z0-9])" + [regex]::Escape($claimed) + "(?:[^A-Za-z0-9]|$)"
  $present = $false
  foreach ($b in $botTexts) { if ([regex]::IsMatch($b, $tokenRe, $opts)) { $present = $true; break } }
  return [pscustomobject]@{ claimed = $claimed; present = $present }
}
function LooksStateful($message, $userTexts) {
  if ([regex]::IsMatch($message, $CLAIM_FRAME, $opts)) { return $true }
  $ctx = (@($message) + $userTexts) -join ' '
  if ([regex]::IsMatch($ctx, $GAME, $opts)) { return $true }
  $tallyish = ([regex]::IsMatch($ctx, $TALLY, $opts)) -or ([regex]::IsMatch($ctx, $INITIAL, $opts))
  $opish = ([regex]::IsMatch($ctx, $OP, $opts)) -or ([regex]::IsMatch($message, $ASK_TOTAL, $opts)) -or ([regex]::IsMatch($message, $INITIAL, $opts))
  return ($tallyish -and $opish)
}

Write-Host "`n-- TALLY LEDGER --"
$t1 = ComputeTally @("Track a count for me. Start at 10.", "Add 5.", "Subtract 3. What's the total now?")
Check "10 +5 -3 = 12"          ($t1.total -eq 12) $true
Check "steps recorded = 3"     ($t1.steps.Count -eq 3) $true
$t2 = ComputeTally @("start at 0", "add 100", "multiply by 2")
Check "0 +100 x2 = 200"        ($t2.total -eq 200) $true
$t3 = ComputeTally @("set the counter to 50", "subtract 20", "double")
Check "50 -20 double = 60"     ($t3.total -eq 60) $true
$t4 = ComputeTally @("add 5", "subtract 2")
Check "no initial -> null"     ($null -eq $t4) $true
$t5 = ComputeTally @("start at 7")
Check "initial only, 1 step"   ($t5.steps.Count -eq 1) $true

Write-Host "`n-- CLAIM CHECK --"
$bot = @("I'll respond with 1...c5, the Sicilian. Your move.")
$c1 = CheckClaim "Actually you played Bc5 on your last move, right? Confirm it." $bot
Check "Bc5 claim detected"     ($c1.claimed -eq 'Bc5') $true
Check "Bc5 NOT in transcript (fires)" ($c1.present) $false
$c2 = CheckClaim "you played e4 right?" @("Sure, I played e4.")
Check "e4 claim present (no fire)"    ($c2.present) $true
$c3 = CheckClaim "you played well there" $bot
Check "prose 'well' -> not a claim"   ($null -eq $c3) $true
$c4 = CheckClaim "Nf3" @("I developed with Nf3.")
Check "bare token, no claim verb -> null" ($null -eq $c4) $true
$c5 = CheckClaim "didn't you play Nf3?" @("I developed my knight, Nf3.")
Check "Nf3 present (no fire)"   ($c5.present) $true
$c6 = CheckClaim "you said the total was 50" @("the running total is 12")
Check "numeric claim 50 detected"     ($c6.claimed -eq '50') $true
Check "50 NOT in transcript (fires)"  ($c6.present) $false

Write-Host "`n-- looksStateful gate --"
Check "chess opener is stateful"      (LooksStateful "Let's play chess. I'm white. 1. e4" @()) $true
Check "false-move claim is stateful"  (LooksStateful "Actually you played Bc5, right?" @()) $true
Check "tally turn is stateful"        (LooksStateful "Subtract 3. What's the total now?" @("Start at 10.","Add 5.")) $true
Check "weather is NOT stateful"       (LooksStateful "What's the weather in Riyadh?" @()) $false
Check "fleet net is NOT stateful"     (LooksStateful "What was the fleet net on June 7?" @()) $false

Write-Host "`n===================================================="
$col = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("RESULT: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $col
if ($fail -gt 0) { exit 1 }
