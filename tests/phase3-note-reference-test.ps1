# phase3-note-reference-test.ps1
# PS 5.1 MIRROR of Phase 3b note-reference resolver (parseNoteReference /
# noteRefContext / parsePendingNoteDeleteContent) + the Build-127 wallet edit-overlay
# merge logic, in lib/orchestrator.js / lib/wallet.js. Node is absent on this host, so
# this mirrors REGEX/MERGE DECISIONS only — Supabase delete/list writes prove LIVE.
#
# Run via UTF-8 read + Invoke-Expression so Arabic literals survive PS 5.1's ANSI default:
#   $s=[IO.File]::ReadAllText('...\tests\phase3-note-reference-test.ps1',[Text.Encoding]::UTF8); iex $s

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$script:pass = 0
$script:fail = 0

function Parse-NoteRef([string]$raw) {
  $m = $raw.Trim()
  if (($m.Length -eq 0) -or ($m.Length -gt 80)) { return '<null>' }
  $enAnaphor = [regex]::IsMatch($m, '\b(it|that|this)\b|\b(?:the\s+)?(?:last|previous)\s+(?:one|note)\b|\blast\s+one\b', 'IgnoreCase')
  $arAnaphor = [regex]::IsMatch($m, 'ذا|ذلك|هذا|هذه|هذي|اللي|الأخيرة|الاخيرة|آخر\s*(?:واحدة|وحدة|ملاحظة)')
  $arClitic  = [regex]::IsMatch($m, '(احذف|امسح|شيل|انس)(ها|ه)')
  $hasAnaphor = $enAnaphor -or $arAnaphor -or $arClitic
  $isDelete = ([regex]::IsMatch($m, '\b(remove|delete|scratch|nix|drop|erase|forget)\b|get\s+rid\s+of', 'IgnoreCase')) -or ([regex]::IsMatch($m, 'احذف|امسح|شيل|انسى|انس|ألغ|الغ|الغي'))
  if ($isDelete -and $hasAnaphor) { return 'delete' }
  if ($hasAnaphor -and (([regex]::IsMatch($m, '\b(?:the\s+)?last\s+(?:one|note)\b|\blast\s+one\b', 'IgnoreCase')) -or ([regex]::IsMatch($m, 'آخر\s*(?:واحدة|وحدة|ملاحظة)|الأخيرة|الاخيرة')))) { return 'show' }
  return '<null>'
}

function Note-RefContext($history) {
  if (($null -eq $history) -or ($history.Count -eq 0)) { return $null }
  $last = $history[$history.Count - 1]
  if (($null -eq $last) -or ($last.role -ne 'assistant')) { return $null }
  $c = [string]$last.content
  if ([regex]::IsMatch($c, 'Delete note |حذف ملاحظة ')) { return 'delete_pending' }
  if ([regex]::IsMatch($c, 'Saved as a note|حفظتها كملاحظة|You have \d+ note|عندك \d+ ملاحظة|Notes about|ملاحظات عن|Deleted the note|حذفت الملاحظة|Your last note|آخر ملاحظة')) { return 'recent' }
  return $null
}

function Get-PendingNoteContent($history) {
  $last = if (($null -ne $history) -and ($history.Count -gt 0)) { $history[$history.Count - 1] } else { $null }
  $c = [string]($last.content)
  $m = [regex]::Match($c, '[«"]([^»"]+)[»"]')
  if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}

# Build-127 mirror: overlay the newest non-null edit onto the add baseline.
function Overlay-Edits($lastAmt, $lastCat, $edits) {
  $amt = $lastAmt; $cat = $lastCat
  $na = $edits | Where-Object { $null -ne $_.amount } | Select-Object -First 1
  $nc = $edits | Where-Object { $null -ne $_.category } | Select-Object -First 1
  if ($na) { $amt = $na.amount }
  if ($nc) { $cat = $nc.category }
  return [pscustomobject]@{ amount = $amt; category = $cat }
}

function Check([string]$name, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $name) }
  else       { $script:fail++; Write-Host ("  FAIL  " + $name) }
}
function ExpectRef([string]$phrase, [string]$label, [string]$expect) {
  $got = Parse-NoteRef $phrase
  Check ("ref " + $label + " -> " + $expect + " (got " + $got + ")") ($got -eq $expect)
}
function Turn([string]$role, [string]$content) { return [pscustomobject]@{ role = $role; content = $content } }

Write-Host "== Phase 3b note-reference resolver — PS 5.1 mirror =="
Write-Host "-- parseNoteReference (EN) --"
ExpectRef "delete it"               "EN delete-it"      "delete"
ExpectRef "remove that"             "EN remove-that"    "delete"
ExpectRef "scratch it"              "EN scratch-it"     "delete"
ExpectRef "get rid of the last one" "EN getrid-last"    "delete"
ExpectRef "forget it"               "EN forget-it"      "delete"
ExpectRef "the last one"            "EN last-one"       "show"
ExpectRef "the last note"           "EN last-note"      "show"
Write-Host "-- parseNoteReference (negatives) --"
ExpectRef "delete the note about taxes" "EN named-del"  "<null>"
ExpectRef "what's the weather"      "EN weather"        "<null>"
ExpectRef "delete"                  "EN bare-delete"    "<null>"
ExpectRef ("remove it " * 12)       "EN long-paste"     "<null>"
Write-Host "-- parseNoteReference (AR) --"
ExpectRef "احذفها"                  "AR delete-clitic"  "delete"
ExpectRef "احذف آخر ملاحظة"          "AR delete-last"    "delete"
ExpectRef "آخر ملاحظة"              "AR last-note"      "show"

Write-Host "-- noteRefContext --"
$saved   = @( (Turn 'assistant' '📝 Saved as a note.') )
$list    = @( (Turn 'assistant' "You have 3 notes:`n1. a`n2. b") )
$search  = @( (Turn 'assistant' 'Notes about "taxes":') )
$deleted = @( (Turn 'assistant' '🗑️ Deleted the note: "old".') )
$delPend = @( (Turn 'assistant' '🗒️ Delete note "buy gift"? Reply "yes" or "no".') )
$arDel   = @( (Turn 'assistant' '🗒️ حذف ملاحظة «اشتري هدية»؟ اكتب «نعم» أو «لا».') )
$offer   = @( (Turn 'assistant' '📝 Want me to save this as a note? Reply yes/no.') )
$general = @( (Turn 'assistant' 'Sure, here is some info about taxes generally.') )
Check "ctx recent (saved)"     ((Note-RefContext $saved)   -eq 'recent')
Check "ctx recent (list)"      ((Note-RefContext $list)    -eq 'recent')
Check "ctx recent (search)"    ((Note-RefContext $search)  -eq 'recent')
Check "ctx recent (deleted)"   ((Note-RefContext $deleted) -eq 'recent')
Check "ctx delete_pending"     ((Note-RefContext $delPend) -eq 'delete_pending')
Check "ctx AR delete_pending"  ((Note-RefContext $arDel)   -eq 'delete_pending')
Check "ctx null (capture offer NOT note ctx)" ($null -eq (Note-RefContext $offer))
Check "ctx null (general reply)" ($null -eq (Note-RefContext $general))

Write-Host "-- parsePendingNoteDeleteContent --"
Check "content EN -> buy gift"  ((Get-PendingNoteContent $delPend) -eq 'buy gift')
Check "content AR -> اشتري هدية" ((Get-PendingNoteContent $arDel)   -eq 'اشتري هدية')

Write-Host "-- Build-127 wallet edit-overlay (current value after edits) --"
$r1 = Overlay-Edits 30 'Groceries' @( (@{amount=50;category=$null}), (@{amount=40;category=$null}) )  # newest-first 50 then 40
Check "overlay newest amount 50 (after 30->40->50)" (($r1.amount -eq 50) -and ($r1.category -eq 'Groceries'))
$r2 = Overlay-Edits 30 'Dining' @( (@{amount=$null;category='Fuel'}) )
Check "overlay category Fuel, amount stays 30" (($r2.amount -eq 30) -and ($r2.category -eq 'Fuel'))
$r3 = Overlay-Edits 30 'Groceries' @()
Check "overlay no edits -> original 30/Groceries" (($r3.amount -eq 30) -and ($r3.category -eq 'Groceries'))

Write-Host ""
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed.")
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
