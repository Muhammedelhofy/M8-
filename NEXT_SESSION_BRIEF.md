# M8 — Next Session Brief
**Written:** 2026-06-15 (Session-33, Opus) · **Branch:** main · **Head:** `aa18326`
**Canonical plan:** [`M8/HONESTY_TRACK_PLAN.md`](HONESTY_TRACK_PLAN.md) ← the living backlog. Read it first.

---

## 🚨 TOP PRIORITY NEXT SESSION: live image vision is broken

The Build-37 live test surfaced that **image attachments are not seen by the model on the deployed API.**

**Confirmed on `m8-alpha.vercel.app` this session:**
| Test | Result |
|---|---|
| Text attachment (Build-33) | ✅ works — reads the file |
| Normal image ("Total: SAR 37") | ❌ "What is the image you want me to read?" |
| Degenerate/blank image | ❌ "What image are you referring to?" |

The request payload was **proven correct** (round-tripped: valid `attachments` array, `kind:image`, MIME `image/png` matches `VISION_MIME`, base64 decodes). Text attachments prove the `attachments` channel reaches the deployed orchestrator — so **the inline image part specifically is being dropped** (`imgTurn=false`/no-inlineData path → model asks "what image?").

**This means Build-37 is offline-proven (20/20) but could NOT be live-verified** — its guard is `imgTurn`-gated and the image never reaches the model.

### ✅ DEPLOY CONFIRMED CURRENT (2026-06-15, Muhammad checked Vercel): Production = `03abaf2`, **Ready**, `main` auto-deploys.
**So it is a REAL Build-34 vision bug — NOT a stale deploy.** No redeploy needed. Go straight to debugging.

### → NEXT SESSION: debug the Build-34 vision path
The image part is dropped somewhere between build and send. Trace, in order:
1. `lib/orchestrator.js` — `buildUserParts()` builds `[{text}, {inlineData:{mimeType,data}}]`; `imgTurn = hasImageAttachments(attachments)`; `providerOrder = visionProviderOrder()` (`gemini,gemini2`). Confirm with a temp log that `imgTurn===true` and the contents array actually contains an `inlineData` part when an image is POSTed. (If `imgTurn` is false here, the bug is upstream in `isImageAttachment`/how `attachments` arrives.)
2. `lib/llm.js` — `generate()` provider mapping: does `"gemini"`/`"gemini2"` resolve to the Gemini fn (not a text-only fn)? Then `generateGeminiWith()` passes `contents` to `ai.models.generateContent({ model, contents, config })`.
3. **Prime suspects** (the call SUCCEEDS and returns text, so the SDK accepted the request but the model didn't get the image): (a) the **`@google/genai` SDK version / `inlineData` field shape** — does the installed SDK want `inlineData:{mimeType,data}` or `inline_data:{mime_type,data}`? (b) the **model env** — is the deployed `GEMINI_MODEL` actually vision-capable, or does the gemini provider use a text-only variant for non-deep turns? (c) anything that **rebuilds/strips `contents`** between `buildUserParts` and the SDK call.
   - Text-only turns work through the same path, so the bug is specific to the extra `inlineData` part — focus there.
- **Repro (PowerShell), then once base vision works run `tests/BUILD37_LIVE_TEST.md`:**
  ```powershell
  # NOTE: force attachments to a JSON ARRAY — PS ConvertTo-Json unwraps 1-elem arrays.
  $att=[ordered]@{name='x.png';kind='image';mimeType='image/png';data=$b64} | ConvertTo-Json -Compress
  $head=[ordered]@{message='what is in this image? read any text.';sessionId='eval_vis'} | ConvertTo-Json -Compress
  $body=$head.Substring(0,$head.Length-1)+',"attachments":['+$att+']}'
  (Invoke-RestMethod -Uri "https://m8-alpha.vercel.app/api/chat" -Method Post -ContentType 'application/json' -Body $body).response
  # a normal image MUST be described; "what image?" = still broken.
  ```

---

## Where we are (all shipped + pushed this session)

| Commit | What |
|---|---|
| `aa18326` | **Build-37 — Silent Vision-Miss Guard.** Success-path guard: an image turn whose reply denies sight ("I can't see images") → honest `IMAGE_BLIND_RESPONSE`, not a blind reply a later turn confabulates from. `VISION_BLIND_RE` + `SAW_IMAGE_RE` veto; precision-guarded so the legit "too blurry to read" hedge survives; success-path only. **Offline `vision-blind-verify.ps1` 20/20; LIVE BLOCKED (see top).** |
| `c51efb2`/`f1f627a`/`25a3e62` | **Team Round 5** brief + synthesis (all 5 crew). Headline: best-of-N integrity holds *by construction*; real risk = selection integrity. Per-probe audit: **14/14 carry their anti-fab signal in an `absent` check.** Decisions: Build-37 = vision guard (done); Build-38 = provenance-at-ingestion; epistemic axis deferred ("trust before taxonomy"). |
| `12fbd57`/`2342cc9` | **Build-36 — best-of-N L5 gate relaxation.** Framing-only flakes re-run (default N=3); fabrication-class (`absent`/`refusal`/`anyOf`) = instant hard block, never re-run. `loop-verify.ps1` 52/52; combined live dry-run 14/14 → ATTEST PASS. |

Also: `M8-L5-Nightly-Attest` task re-registered (StartWhenAvailable, battery-resilient, 1h limit; `CRON_SECRET` confirmed User-level; still Interactive logon — S4U needs an elevated shell).

---

## After vision is resolved → Build-38 (was the planned next build)
**Provenance + `trust_state` at ingestion** (crew-unanimous Q2, "trust before taxonomy"). Extend Build-30
provenance beyond `m8_conversations` to **graph nodes + the Build-27 intake path**: every node carries
`source · timestamp · evidence_kind (hypothesis/experiment/result/failed_path) · confidence ·
verification_state` *before* graph expansion scales. Enabler for both the epistemic axis and L6.
*Files: intake / `lib/memory-graph.js`.* Then: broaden search routing (`lib/intentClassifier.js`);
the deferred full epistemic axis. Round-5 honesty follow-ups (per-attempt telemetry, selector-stress
probes, `GRAPH_EVIDENCE_CAP` verification, uncertainty-calibration probes) — see HONESTY_TRACK_PLAN backlog.

---

## Standing notes
- Live runs hit `m8-alpha.vercel.app` + cost Gemini quota — run deliberately; need explicit authorization.
- The nightly L5 attestation fires ~05:00 AST; with Build-36 the gate can now actually accumulate clean nights — watch the next few land + confirm the POST reaches `/api/loop-attest`.
- PS gotcha (bit us this session): `ConvertTo-Json` unwraps a single-element array → force the `attachments` JSON array by hand (see repro above).

## Kickoff prompt to paste into the next session
> Continue M8. Read `M8/HONESTY_TRACK_PLAN.md` and `M8/NEXT_SESSION_BRIEF.md` first. **Top priority: live image vision is broken** (text attachments work, images aren't seen — model says "what image?"). Deploy is CONFIRMED current (Production `03abaf2`, Ready, main auto-deploys) → it's a **real Build-34 vision bug, not a stale deploy**. Debug the image path (`lib/orchestrator.js buildUserParts`/`imgTurn` → `lib/llm.js generate`/`generateGeminiWith` → the `@google/genai` `inlineData` send; prime suspects = SDK field shape `inlineData` vs `inline_data`, the vision model variant, or `contents` being stripped). Add a temp log to confirm `imgTurn` and that an `inlineData` part reaches the SDK call. Fix → re-run the PowerShell image repro (a normal image must be described) → then `tests/BUILD37_LIVE_TEST.md`. After vision is confirmed, start **Build-38 (provenance + trust_state at ingestion)**. Keep the free Gemini/Tavily stack; no paid APIs. Update `M8/HONESTY_TRACK_PLAN.md` as you go.
