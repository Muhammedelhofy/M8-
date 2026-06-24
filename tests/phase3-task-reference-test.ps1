# phase3-task-reference-test.ps1
# PS 5.1 MIRROR of the Phase 3a deterministic task-reference resolver in
# lib/orchestrator.js (parseTaskReference / taskRefContext / parsePendingTaskDeleteTitle).
# Node is absent on this host, so this mirrors the REGEX DECISIONS only — the Supabase
# delete/done/show writes and the confirm-gating prove LIVE on m8-alpha.
#
# Run via UTF-8 read + Invoke-Expression so Arabic literals survive PS 5.1's ANSI default:
#   $s=[IO.File]::ReadAllText('...\tests\phase3-task-reference-test.ps1',[Text.Encoding]::UTF8); iex $s

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$TASK = [char]0x2064   # TASK_SENTINEL (distinct from MONEY_SENTINEL U+2063)
$script:pass = 0
$script:fail = 0

function Parse-TaskRef([string]$raw) {
  $m = $raw.Trim()
  if (($m.Length -eq 0) -or ($m.Length -gt 80)) { return '<null>' }
  $enAnaphor = [regex]::IsMatch($m, '\b(it|that|this)\b|\b(?:the\s+)?(?:last|previous)\s+(?:one|task|to-?do)\b|\blast\s+one\b', 'IgnoreCase')
  $arAnaphor = [regex]::IsMatch($m, 'ذا|ذلك|هذا|هذه|هذي|اللي|الأخيرة|الاخيرة|آخر\s*(?:واحدة|وحدة|مهمة)')
  $arClitic  = [regex]::IsMatch($m, '(احذف|امسح|شيل|خلصت|خلّصت|سويت|سوّيت|أنهيت|انهيت)(ها|هم|ه)')
  $hasAnaphor = $enAnaphor -or $arAnaphor -or $arClitic
  $isDelete = ([regex]::IsMatch($m, '\b(remove|delete|scratch|nix|drop|erase|cancel)\b|get\s+rid\s+of', 'IgnoreCase')) -or ([regex]::IsMatch($m, 'احذف|امسح|شيل|ألغ|الغ|الغي'))
  $enDone = ([regex]::IsMatch($m, '\b(?:done|finished?|completed?|did)\b', 'IgnoreCase')) -or ([regex]::IsMatch($m, '\b(?:check|tick)(?:ed)?\b[\w\s]{0,10}\boff\b', 'IgnoreCase'))
  $arDone = [regex]::IsMatch($m, 'خلصت|خلّصت|أنهيت|انهيت|سويت|سوّيت')
  if (($enDone -and $hasAnaphor) -or $arDone) { return 'done' }
  if ($isDelete -and $hasAnaphor) { return 'delete' }
  if ($hasAnaphor -and (([regex]::IsMatch($m, '\b(?:the\s+)?last\s+(?:one|task|to-?do)\b|\blast\s+one\b', 'IgnoreCase')) -or ([regex]::IsMatch($m, 'آخر\s*(?:واحدة|وحدة|مهمة)|الأخيرة|الاخيرة')))) { return 'show' }
  return '<null>'
}

function Task-RefContext($history) {
  if (($null -eq $history) -or ($history.Count -eq 0)) { return $null }
  $last = $history[$history.Count - 1]
  if (($null -eq $last) -or ($last.role -ne 'assistant')) { return $null }
  $c = [string]$last.content
  if ($c.IndexOf($TASK) -lt 0) { return $null }
  if ([regex]::IsMatch($c, 'Delete task |حذف مهمة ')) { return 'delete_pending' }
  return 'recent'
}

function Get-PendingDeleteTitle($history) {
  $last = if (($null -ne $history) -and ($history.Count -gt 0)) { $history[$history.Count - 1] } else { $null }
  $c = [string]($last.content)
  $m = [regex]::Match($c, '[«"]([^»"]+)[»"]')
  if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}

function Check([string]$name, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $name) }
  else       { $script:fail++; Write-Host ("  FAIL  " + $name) }
}
function ExpectRef([string]$phrase, [string]$label, [string]$expect) {
  $got = Parse-TaskRef $phrase
  Check ("ref " + $label + " -> " + $expect + " (got " + $got + ")") ($got -eq $expect)
}

Write-Host "== Phase 3a task-reference resolver — PS 5.1 mirror =="
Write-Host "-- parseTaskReference (EN) --"
ExpectRef "scratch it"                "EN scratch-it"      "delete"
ExpectRef "remove it"                 "EN remove-it"       "delete"
ExpectRef "delete that"               "EN delete-that"     "delete"
ExpectRef "get rid of the last one"   "EN getrid-last"     "delete"
ExpectRef "remove it from my list"    "EN remove-it-list"  "delete"
ExpectRef "mark it done"              "EN mark-it-done"    "done"
ExpectRef "did it"                    "EN did-it"          "done"
ExpectRef "i finished that"           "EN finished-that"   "done"
ExpectRef "checked it off"            "EN checked-off"     "done"
ExpectRef "the last one"              "EN the-last-one"    "show"
ExpectRef "what was the last task"    "EN last-task"       "show"

Write-Host "-- parseTaskReference (negatives) --"
ExpectRef "done"                      "EN bare-done"       "<null>"
ExpectRef "remove the milk task"      "EN named-delete"    "<null>"
ExpectRef "add buy milk"             "EN add"             "<null>"
ExpectRef "what's the weather"        "EN weather"         "<null>"
ExpectRef ("remove it " * 12)         "EN long-paste"      "<null>"

Write-Host "-- parseTaskReference (AR) --"
ExpectRef "احذف آخر مهمة"             "AR delete-last"     "delete"
ExpectRef "احذفها"                    "AR delete-clitic"   "delete"
ExpectRef "خلصتها"                    "AR done-clitic"     "done"
ExpectRef "أنهيت المهمة"             "AR finished"        "done"
ExpectRef "آخر مهمة"                  "AR last-task"       "show"

Write-Host "-- taskRefContext --"
function Turn([string]$role, [string]$content) { return [pscustomobject]@{ role = $role; content = $content } }
$recent  = @( (Turn 'user' 'add buy milk'), (Turn 'assistant' ('Added to your list: "buy milk".' + $TASK)) )
$delPend = @( (Turn 'assistant' ('🗑️ Delete task "buy milk"? Reply "yes" or "no".' + $TASK)) )
$arDel   = @( (Turn 'assistant' ('🗑️ حذف مهمة «اشتري حليب»؟ اكتب «نعم» أو «لا».' + $TASK)) )
$noSent  = @( (Turn 'assistant' 'Added to your list: "buy milk".') )
$moneyT  = @( (Turn 'assistant' ('Done logged 30 EGP' + [char]0x2063)) )  # MONEY sentinel, not TASK
$userL   = @( (Turn 'assistant' ('x' + $TASK)), (Turn 'user' 'scratch it') )
Check "ctx recent"            ((Task-RefContext $recent)  -eq 'recent')
Check "ctx delete_pending"    ((Task-RefContext $delPend) -eq 'delete_pending')
Check "ctx AR delete_pending" ((Task-RefContext $arDel)   -eq 'delete_pending')
Check "ctx null (no task sentinel)"     ($null -eq (Task-RefContext $noSent))
Check "ctx null (money sentinel only)"  ($null -eq (Task-RefContext $moneyT))
Check "ctx null (last is user)"         ($null -eq (Task-RefContext $userL))

Write-Host "-- parsePendingTaskDeleteTitle --"
Check "title EN -> buy milk"  ((Get-PendingDeleteTitle $delPend) -eq 'buy milk')
Check "title AR -> اشتري حليب" ((Get-PendingDeleteTitle $arDel)   -eq 'اشتري حليب')

Write-Host ""
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed.")
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
