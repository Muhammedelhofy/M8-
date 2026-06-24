# phase2-reference-test.ps1
# PS 5.1 MIRROR of the Phase 2 deterministic reference resolver in lib/orchestrator.js
# (refHasAnaphor / parseReference / walletRefContext). Node is absent on this host, so
# this mirrors the REGEX DECISIONS only — the async getLastM8Write/LLM bits and the
# confirm-card wiring are proven LIVE on m8-alpha, not here.
#
# IMPORTANT: run via UTF-8 read + Invoke-Expression so the Arabic literals survive
# PS 5.1's ANSI default:
#   $s=[IO.File]::ReadAllText('...\tests\phase2-reference-test.ps1',[Text.Encoding]::UTF8); iex $s
#
# Mirror notes (kept faithful to the JS): \b is ASCII-only in JS, so the Arabic
# patterns use NO \b (substring match on the verb stem). .NET \b is Unicode-aware but
# only the ASCII English patterns use it, so behaviour matches for these cases.

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$SENT = [char]0x2063   # MONEY_SENTINEL (U+2063, invisible)
$script:pass = 0
$script:fail = 0

function Norm-Digits([string]$t) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $t.ToCharArray()) {
    $c = [int][char]$ch
    if     ($c -ge 0x0660 -and $c -le 0x0669) { [void]$sb.Append([char]($c - 0x0660 + 48)) }
    elseif ($c -ge 0x06F0 -and $c -le 0x06F9) { [void]$sb.Append([char]($c - 0x06F0 + 48)) }
    else { [void]$sb.Append($ch) }
  }
  return $sb.ToString()
}

# Mirror of: parseAmountCurrency() amount, dropped to $null when <= 0.
function Get-RefAmount([string]$text) {
  $t = Norm-Digits $text
  $m = [regex]::Match($t, '(\d+(?:[.,]\d+)?)')
  if (-not $m.Success) { return $null }
  $a = [double]($m.Groups[1].Value -replace ',', '.')
  if ($a -le 0) { return $null }
  return $a
}

function Ref-HasAnaphor([string]$m) {
  if ([regex]::IsMatch($m, '\b(it|that|this|those|these)\b|\b(?:the\s+)?(?:last|previous|recent)\s+(?:one|expense|entry)\b|\blast\s+one\b', 'IgnoreCase')) { return $true }
  if ([regex]::IsMatch($m, 'ذا|ذلك|هذا|هذه|هذي|اللي|الأخير|الاخير|آخر\s*(?:واحد|مصروف|عملية|شي)')) { return $true }
  if ([regex]::IsMatch($m, 'احذف|امسح|شيل|ألغ|الغ|خلّ|خل|خلي|عدّل|عدل|غيّر|غير|صحّح|صحح|رجّع|رجع')) { return $true }
  return $false
}

function Parse-Reference([string]$raw) {
  $m = $raw.Trim()
  if (($m.Length -eq 0) -or ($m.Length -gt 80)) { return $null }
  if (-not (Ref-HasAnaphor $m)) { return $null }
  $amt = Get-RefAmount $m
  $isDelete = ([regex]::IsMatch($m, '\b(remove|delete|undo|scratch|nix|drop|forget|erase)\b|get\s+rid\s+of|take\s+(?:it|that)\s+back', 'IgnoreCase')) -or `
              ([regex]::IsMatch($m, 'احذف|امسح|شيل|ألغ|الغ|تراجع|رجّع|رجع'))
  $isEdit   = ([regex]::IsMatch($m, '\b(change|make|set|update|fix|correct|edit|adjust|bump|raise|lower)\b', 'IgnoreCase')) -or `
              ([regex]::IsMatch($m, 'غيّر|غير|خلّ|خل|خلي|عدّل|عدل|صحّح|صحح'))
  if ($isEdit -and ($null -ne $amt)) { return [pscustomobject]@{ action = 'edit';   amount = $amt } }
  if ($isDelete)                     { return [pscustomobject]@{ action = 'delete'; amount = $null } }
  if ($isEdit)                       { return [pscustomobject]@{ action = 'edit';   amount = $null } }
  if (([regex]::IsMatch($m, '\b(?:the\s+)?last\s+(?:one|expense|entry)\b|\blast\s+one\b', 'IgnoreCase')) -or ([regex]::IsMatch($m, 'آخر\s*(?:واحد|مصروف|عملية)|الأخير|الاخير'))) {
    return [pscustomobject]@{ action = 'show'; amount = $null }
  }
  return $null
}

function Wallet-RefContext($history) {
  if (($null -eq $history) -or ($history.Count -eq 0)) { return $null }
  $last = $history[$history.Count - 1]
  if (($null -eq $last) -or ($last.role -ne 'assistant')) { return $null }
  $c = [string]$last.content
  if ($c.IndexOf($SENT) -lt 0) { return $null }
  if ([regex]::IsMatch($c, '^[\s' + $SENT + ']*🧾\s*(Confirm expense|تأكيد مصروف)')) { return 'add_pending' }
  if ([regex]::IsMatch($c, '^[\s' + $SENT + ']*🧾\s*(Update last expense|تعديل آخر مصروف)')) { return 'edit_pending' }
  return 'recent'
}

function Check([string]$name, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $name) }
  else       { $script:fail++; Write-Host ("  FAIL  " + $name) }
}

function ExpectRef([string]$phrase, [string]$label, [string]$expectAction, $expectAmount) {
  $r = Parse-Reference $phrase
  if ($null -eq $r) { $gotAction = '<null>'; $gotAmount = $null }
  else              { $gotAction = $r.action; $gotAmount = $r.amount }
  $ok = ($gotAction -eq $expectAction) -and ($gotAmount -eq $expectAmount)
  Check ("ref " + $label + " -> " + $expectAction + " " + ([string]$expectAmount) + " (got " + $gotAction + " " + ([string]$gotAmount) + ")") $ok
}

Write-Host "== Phase 2 reference resolver — PS 5.1 mirror =="
Write-Host "-- parseReference (EN) --"
ExpectRef "change that to 40"        "EN change-to-40"      "edit"   40
ExpectRef "make it 50"              "EN make-it-50"        "edit"   50
ExpectRef "set it to 12.5"          "EN set-it-12.5"       "edit"   12.5
ExpectRef "remove it"               "EN remove-it"         "delete" $null
ExpectRef "undo that"              "EN undo-that"         "delete" $null
ExpectRef "scratch it"             "EN scratch-it"        "delete" $null
ExpectRef "get rid of it"          "EN get-rid-of-it"     "delete" $null
ExpectRef "delete the last expense" "EN delete-last-exp"   "delete" $null
ExpectRef "the last one"           "EN the-last-one"      "show"   $null
ExpectRef "what was the last one"  "EN what-last-one"     "show"   $null
ExpectRef "change it"              "EN change-it-noamt"   "edit"   $null
ExpectRef "make it 0"             "EN make-it-0"         "edit"   $null

Write-Host "-- parseReference (negatives: anaphor present but no action, or no anaphor) --"
ExpectRef "change my plans"        "EN change-my-plans"   "<null>" $null
ExpectRef "what's the weather"     "EN weather"           "<null>" $null
ExpectRef "thanks that helps"      "EN thanks-that"       "<null>" $null
ExpectRef ""                       "EN empty"             "<null>" $null
ExpectRef ("remove it " * 10)      "EN long-paste-guard"  "<null>" $null

Write-Host "-- parseReference (AR) --"
ExpectRef "احذف آخر مصروف"          "AR delete-last-exp"   "delete" $null
ExpectRef "خله ٤٠"                  "AR khalleh-40"        "edit"   40
ExpectRef "غيّره ل ٥٠"               "AR ghayyer-50"        "edit"   50
ExpectRef "شيله"                    "AR sheelo"            "delete" $null
ExpectRef "آخر مصروف"               "AR last-expense"      "show"   $null

Write-Host "-- Tier-2 handoff: refHasAnaphor TRUE but parseReference NULL (fuzzy verb) --"
Check "anaphor 'obliterate that one' is anaphoric" (Ref-HasAnaphor "obliterate that one")
Check "'obliterate that one' -> parseReference null (LLM fallback)" ($null -eq (Parse-Reference "obliterate that one"))
Check "'thanks that helps' NOT a parseable ref" ($null -eq (Parse-Reference "thanks that helps"))

Write-Host "-- walletRefContext --"
# NB: do NOT name this 'H' — PS is case-insensitive and 'h' is the built-in alias
# for Get-History, which would shadow the helper. (Mirror gotcha, not a JS issue.)
function Turn([string]$role, [string]$content) { return [pscustomobject]@{ role = $role; content = $content } }
$recent  = @( (Turn 'user' 'yes'), (Turn 'assistant' ("Done $([char]0x2713) logged 30 EGP $([char]0x00B7) Groceries (tagged [M8])." + $SENT)) )
$addPend = @( (Turn 'assistant' ("🧾 Confirm expense — add 30 EGP $([char]0x00B7) Groceries? Reply ""yes"" to log it (or ""no"" to cancel)." + $SENT)) )
$editPend= @( (Turn 'assistant' ("🧾 Update last expense (30 EGP $([char]0x00B7) Groceries) -> 40 EGP? Reply ""yes"" or ""no""." + $SENT)) )
$arAdd   = @( (Turn 'assistant' ("🧾 تأكيد مصروف — أضيف 30 EGP." + $SENT)) )
$noSent  = @( (Turn 'assistant' "Done logged 30 EGP Groceries") )
$userLast= @( (Turn 'assistant' ("x" + $SENT)), (Turn 'user' 'remove it') )

Check "ctx recent"        ((Wallet-RefContext $recent)   -eq 'recent')
Check "ctx add_pending"   ((Wallet-RefContext $addPend)  -eq 'add_pending')
Check "ctx edit_pending"  ((Wallet-RefContext $editPend) -eq 'edit_pending')
Check "ctx AR add_pending" ((Wallet-RefContext $arAdd)   -eq 'add_pending')
Check "ctx null when no sentinel" ($null -eq (Wallet-RefContext $noSent))
Check "ctx null when last is user" ($null -eq (Wallet-RefContext $userLast))
Check "ctx null when empty history" ($null -eq (Wallet-RefContext @()))

Write-Host ""
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed.")
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
