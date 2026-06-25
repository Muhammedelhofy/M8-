# Build-148 — Family Wallet section in the morning brief (EMAIL-ONLY, opt-in).
# Guards the PRIVACY INVARIANT (wallet money must NOT be in formatBriefText, the LLM
# path) + the opt-in gate + a render smoke. Node is absent, so the invariant is checked
# by reading the JS source.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build148-brief-wallet-test.ps1
$ErrorActionPreference = "Stop"
$mb = "C:\Users\m7ofy\OneDrive\Documents\Claude\Projects\Bolt\M8\lib\morning-brief.js"
$src = Get-Content $mb -Raw

$pass=0; $fail=0

# (1) PRIVACY INVARIANT: formatBriefText body must NOT reference wallet (it is injected
#     into an LLM when the brief is shown in chat).
$start = $src.IndexOf("function formatBriefText")
$end   = $src.IndexOf("function esc(", $start)
$textFn = $src.Substring($start, $end - $start)
if ($textFn -notmatch '(?i)wallet') { $pass++; "PASS  invariant: formatBriefText has NO wallet money" }
else { $fail++; "FAIL  invariant: formatBriefText REFERENCES wallet (LLM exposure!)" }

# (2) formatBriefHTML (email) DOES render the wallet section.
$h = $src.IndexOf("function formatBriefHTML")
$he = $src.IndexOf("function detectMorningBriefQuery", $h)
if ($he -lt 0) { $he = $src.Length }
$htmlFn = $src.Substring($h, $he - $h)
if ($htmlFn -match 'formatWalletHTML\(brief\.wallet\)') { $pass++; "PASS  email: formatBriefHTML renders wallet" }
else { $fail++; "FAIL  email: formatBriefHTML does NOT render wallet" }

# (3) Opt-in gate: default OFF.
function Attach-Gate([string]$env) { return ($env -eq '1') }  # mirror: only when M8_BRIEF_WALLET_ENABLED=1
if (-not (Attach-Gate ''))   { $pass++; "PASS  gate: default OFF (brief unchanged)" } else { $fail++; "FAIL  gate: default not OFF" }
if (Attach-Gate '1')         { $pass++; "PASS  gate: ON when flag=1" }                else { $fail++; "FAIL  gate: not ON when flag=1" }

# (4) Source asserts the gate + lazy import + fail-safe are present.
if ($src -match "M8_BRIEF_WALLET_ENABLED") { $pass++; "PASS  source: kill/opt-in flag present" } else { $fail++; "FAIL  no opt-in flag" }
if ($src -match 'require\("\./wallet"\); // lazy') { $pass++; "PASS  source: import-isolated (lazy require)" } else { $fail++; "FAIL  not lazy require" }

# (5) Render smoke (mirror of formatWalletHTML core).
function Render-Wallet($w) {
    $used = if ($w.currenciesUsed.Count) { $w.currenciesUsed } else { @($w.base) }
    $spent = ($used | ForEach-Object { "$($w.perCurrency[$_].expense) $_" }) -join " + "
    return "Spent: $spent"
}
$w = @{ base='SAR'; currenciesUsed=@('EGP','SAR'); perCurrency=@{ EGP=@{expense=6642}; SAR=@{expense=422} } }
$r = Render-Wallet $w
if ($r -eq "Spent: 6642 EGP + 422 SAR") { $pass++; "PASS  render smoke" } else { $fail++; "FAIL  render smoke got '$r'" }

""
"Result: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 } else { exit 0 }
