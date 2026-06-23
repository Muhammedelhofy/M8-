# Phase 0 Safety Net — PowerShell 5.1 mirror of capabilityFallback() in lib/orchestrator.js.
# Node is absent on this host, so this re-implements the deterministic regex routing
# (ENGLISH cases) and asserts the domain each message resolves to. Arabic phrasing and
# the live DOC-skip guard / upstream-lane interaction are covered by PHASE0_LIVE_TEST.md.
$ErrorActionPreference = 'Stop'

# Patterns mirror orchestrator.js (English portions; Arabic alternates omitted here).
$MONEY  = '\b(expenses?|wallet|balance|transactions?|spend(?:ing)?|spent)\b'
$TASK   = '\b(tasks?|reminders?|to-?dos?)\b'
$NOTE   = '\b(notes?)\b'
$ACTION = '\b(add|new|log|record|remove|delete|drop|cancel|clear|undo|change|update|edit|fix|set|mark|complete|finish|done|scratch|forget)\b|get\s+rid'
# Stand-in for looksFleet()/looksFinance(): the real code uses richer detectors, but
# this keyword set is sufficient for the money-vs-fleet exclusion test cases below.
$FLEETISH = '\b(fleet|drivers?|tier|bonus|cars?|net|revenue|profit|p&l|cash|fuel)\b'

function Get-Domain([string]$msg) {
  $m = if ($null -eq $msg) { '' } else { $msg }
  $opt = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  if ([regex]::IsMatch($m, $MONEY, $opt) -and -not [regex]::IsMatch($m, $FLEETISH, $opt)) { return 'money' }
  if ([regex]::IsMatch($m, $TASK,  $opt) -and [regex]::IsMatch($m, $ACTION, $opt)) { return 'task' }
  if ([regex]::IsMatch($m, $NOTE,  $opt) -and [regex]::IsMatch($m, $ACTION, $opt)) { return 'note' }
  return 'none'
}

$cases = @(
  @{ msg = 'remove the last expense of 50 sar';                  want = 'money' }  # the screenshot loop
  @{ msg = 'what was the last expense sara did on the wallet?';  want = 'money' }  # the screenshot loop
  @{ msg = 'remove the last transaction 50 sar from the wallet'; want = 'money' }  # the screenshot loop
  @{ msg = 'get rid of that wallet balance entry';               want = 'money' }
  @{ msg = 'how much did the fleet spend on fuel this month';    want = 'none'  }  # money word BUT fleet -> excluded
  @{ msg = 'delete the gym task';                                want = 'task'  }
  @{ msg = 'mark the gym task done';                             want = 'task'  }
  @{ msg = "what's a good task app";                             want = 'none'  }  # task noun, NO action -> general
  @{ msg = 'delete the note about insurance';                    want = 'note'  }
  @{ msg = 'what are my notes';                                  want = 'none'  }  # note noun, NO action -> general
  @{ msg = 'what is the weather today';                          want = 'none'  }  # general chat untouched
  @{ msg = 'make me rich';                                       want = 'none'  }  # general chat untouched
)

$fail = 0
foreach ($c in $cases) {
  $got = Get-Domain $c.msg
  if ($got -eq $c.want) {
    Write-Host ("PASS [{0,-5}] {1}" -f $got, $c.msg)
  } else {
    $fail++
    Write-Host ("FAIL want={0} got={1} :: {2}" -f $c.want, $got, $c.msg)
  }
}
Write-Host ''
if ($fail -eq 0) {
  Write-Host ("ALL {0} CASES PASSED" -f $cases.Count)
} else {
  Write-Host ("{0} FAILURE(S) of {1}" -f $fail, $cases.Count)
  exit 1
}
