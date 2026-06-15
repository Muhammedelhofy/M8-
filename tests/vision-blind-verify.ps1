# ============================================================================
# M8 Build-37 -- Silent Vision-Miss Guard: PS mirror of lib/orchestrator.js
# ----------------------------------------------------------------------------
# No local Node, so VISION_BLIND_RE / SAW_IMAGE_RE are mirrored here (byte-for-byte
# the same regex SOURCE, in single-quoted here-strings) and the blind-guard DECISION
# (blind = VISION_BLIND matches AND SAW_IMAGE does NOT) is asserted. Pure ASCII.
#   powershell -File tests/vision-blind-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- mirror of lib/orchestrator.js VISION_BLIND_RE (success-path blindness) ----
$VISION_BLIND = @'
(?:(?:can'?t|cannot|can\s+not|unable\s+to|not\s+able\s+to|don'?t\s+have\s+the\s+ability\s+to|do\s+not\s+have\s+the\s+ability\s+to)\s+(?:actually\s+|currently\s+|really\s+|literally\s+|physically\s+)?(?:see|view|access|open|display|perceive|process)\s+(?:the\s+|this\s+|that\s+|any\s+|your\s+|an?\s+)?(?:image|images|picture|pictures|photo|photos|attachment|attachments|screenshot|visual)(?!\s+(?:clearly|well|properly|sharply|fully|in\s+detail))|(?:please\s+)?(?:provide|attach|upload|share|paste|send|re-?send|re-?share|post)\s+(?:the\s+|an?\s+|your\s+|that\s+)?(?:image|picture|photo|screenshot|attachment)|(?:don'?t\s+see|do\s+not\s+see|not\s+seeing|didn'?t\s+(?:get|receive)|haven'?t\s+received|there\s+(?:is|'?s)\s+no|i\s+see\s+no)\s+(?:any\s+|an?\s+|the\s+)?(?:image|picture|photo|attachment|screenshot)|no\s+(?:image|picture|photo|attachment|screenshot)\b[^.!?]{0,40}(?:attach|provid|upload|here|present|receiv|came\s+through|come\s+through)|(?:image|picture|photo|attachment|screenshot)\s+(?:was\s+not|wasn'?t|is\s+not|isn'?t|hasn'?t\s+been|did\s+not\s+come|didn'?t\s+come)\s+(?:attached|provided|uploaded|included|received|through)|text[\s-]?based\s+(?:ai|model|assistant|language\s+model)|i\s+(?:can\s+only|only)\s+(?:process|read|handle)\s+text|i\s+(?:can'?t|cannot)\s+process\s+images?)
'@

# ---- mirror of SAW_IMAGE_RE (veto: the reply engaged with the image content) ----
$SAW_IMAGE = @'
\b(?:i\s+can\s+see|i\s+see\s+(?:a|an|the|that|what)|i\s+can\s+make\s+out|the\s+(?:image|picture|photo|receipt|screenshot|document|invoice|chart|graph)\s+(?:shows|contains|depicts|displays|reads|says|is\s+of|appears\s+to)|here'?s\s+what\s+(?:the\s+image|i\s+(?:can\s+)?see)|in\s+the\s+(?:image|picture|photo|screenshot))\b
'@

function MB([string]$t) { return [regex]::IsMatch($t, $VISION_BLIND, 'IgnoreCase') }
function MS([string]$t) { return [regex]::IsMatch($t, $SAW_IMAGE,   'IgnoreCase') }
# the guard's decision in orchestrator.js: imgTurn && VISION_BLIND && !SAW_IMAGE
function IsBlind([string]$t) { return (MB $t) -and (-not (MS $t)) }

Write-Host "`nM8 Build-37 -- silent vision-miss guard (orchestrator mirror)`n"

# ---- 1. BLIND (must be caught -> honest fallback) ---------------------------
Ok (IsBlind "I can't see images.")                                              "A: modality denial 'can't see images'"
Ok (IsBlind "I'm unable to view the image you attached.")                       "A: 'unable to view the image'"
Ok (IsBlind "As a text-based AI, I can't see the image.")                       "A+D: text-based AI can't see the image"
Ok (IsBlind "I cannot process images.")                                        "A/D: 'cannot process images'"
Ok (IsBlind "Please provide the image and I'll take a look.")                   "B: 'please provide the image'"
Ok (IsBlind "Could you attach the screenshot so I can help?")                   "B: 'attach the screenshot'"
Ok (IsBlind "I don't see any image attached.")                                  "C: 'don't see any image'"
Ok (IsBlind "It seems no image was provided.")                                  "C: bare 'no image ... provided'"
Ok (IsBlind "The image didn't come through on my end.")                         "C: 'image didn't come through'"
Ok (IsBlind "I'm a text-based model and can only handle text.")                 "D: text-only self-id"

# ---- 2. NOT BLIND (legit quality hedge / real engagement -> keep) -----------
Ok (-not (IsBlind "The image is too blurry to read the total amount."))         "hedge: 'too blurry to read' (read != blind verb)"
Ok (-not (IsBlind "I can see the receipt, but the bottom line is too faint to read.")) "veto: 'I can see the receipt'"
Ok (-not (IsBlind "The receipt shows a total of SAR 240.50 on 2026-06-01."))    "veto: 'the receipt shows'"
Ok (-not (IsBlind "I cannot clearly see the image -- can you confirm the number?")) "precision: 'cannot CLEARLY see' is a quality hedge, not blindness"
Ok (-not (IsBlind "In the image I can make out a bar chart, but the axis labels are illegible.")) "veto: 'in the image' + 'make out'"
Ok (-not (IsBlind "Here's what the image shows: revenue trending up."))         "veto: 'the image shows'"
Ok (-not (IsBlind "The fleet net this week is SAR 1,240."))                     "non-vision answer untouched"
Ok (-not (IsBlind "There are no image artifacts or compression noise visible.")) "bare 'no image' w/o presence word does NOT trigger"

# ---- 3. why the guard is SUCCESS-PATH-ONLY ---------------------------------
# The throw path already returns IMAGE_FALLBACK_RESPONSE (quota). It LOOKS blind by
# regex ('can't view the image') -- so running the guard there would wrongly relabel a
# quota failure as a blind read. This asserts that risk exists, documenting why the
# guard lives only in the success branch (never the catch).
$IMAGE_FALLBACK = "I can't view the image right now -- the image-capable model may have hit its usage limit. Please try again in a little while, or describe what's in the image in text and I'll help."
Ok (MB $IMAGE_FALLBACK)  "throw-path quota msg matches VISION_BLIND -> guard MUST be success-path-only"

# The replacement message itself must NOT re-trigger (idempotent / no double-replace).
$IMAGE_BLIND = "I couldn't actually read that image -- it may be blank, too low-quality, or it didn't come through on my end. Could you re-share it (a clearer copy helps), or tell me what's in it and I'll take it from there?"
Ok (-not (IsBlind $IMAGE_BLIND)) "IMAGE_BLIND_RESPONSE is not itself classified blind (idempotent)"

# ---- tally ------------------------------------------------------------------
Write-Host ("`n==== vision-blind-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail) { 'Red' } else { 'Green' })
if ($script:fail) { exit 1 }
