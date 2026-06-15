# BUILD_37_SPEC — Silent Vision-Miss Guard

*Scope: close the silent-failure gap in the Build-34 vision path — when a vision-capable model **succeeds** but its reply **denies seeing the image**, return an honest fallback instead of letting a blind reply be stored and confabulated from later. Decided by **Team Round 5** (consensus Build-37; "a failed search is visible, a missed image is invisible → false confidence"). No new capability, no new provider, no paid APIs — a honesty guard on the existing path.*

---

## The gap

Build-34 added image attachments and a vision honesty guard — but a **throw-only** one ([orchestrator.js](lib/orchestrator.js) catch block): `IMAGE_FALLBACK_RESPONSE` fires only when **every** vision provider is down (`generate()` throws). It misses the case where vision **succeeds**:

- A vision-capable model (Gemini Flash/Pro) **returns a string** — so the catch never runs — but the *text* is a model-authored denial: *"I can't see images,"* *"please attach the image,"* *"as a text-based AI…"*. Gemini does this on **near-blank, degenerate, or dropped** images.
- That blind reply is `response`, gets `saveMemory`'d, and a **later** turn can confabulate from it. Same fabrication class as the Build-33b empty-search guard (a successful-but-empty result the model fills from priors).

Found in Build-34 verification (NEXT_SESSION_BRIEF Session-32): *"vision is reliable on normal images but flakes to a model-authored 'I cannot see images' on near-blank/degenerate images — and that silent miss is NOT caught by the throw-only `IMAGE_FALLBACK` guard."*

## The fix

A **success-path** classifier in `orchestrate()` (the single owner of the vision path — `orchestrateStream` delegates image turns to it, Build-34). On an image turn (`imgTurn`), after a valid non-empty `response`:

```
if (imgTurn && VISION_BLIND_RE.test(response) && !SAW_IMAGE_RE.test(response)) {
  log("vision_blind_miss");
  response = IMAGE_BLIND_RESPONSE;
}
```

- **`VISION_BLIND_RE`** — model-authored blindness: (A) modality denial *can't **see/view/access/open/display/perceive/process** the image*; (B) *please **provide/attach/upload/share** the image* (asking for what's already attached); (C) *no image was **provided/attached** / didn't come through*; (D) *text-based AI / can only handle text / cannot process images*.
- **`SAW_IMAGE_RE`** (veto) — evidence the model engaged with the content: *"I can see…", "the receipt shows…", "in the image…", "I can make out…"*. If present, the guard does **not** fire — so a real answer that merely asks for a clearer copy ("the receipt shows $40, but send a sharper photo of the date") is never clobbered.
- **`IMAGE_BLIND_RESPONSE`** — distinct from the quota message: *"I couldn't actually read that image — it may be blank, too low-quality, or it didn't come through… re-share it, or tell me what's in it."* (The quota path keeps `IMAGE_FALLBACK_RESPONSE`; the two causes get honest, different wording.)

## Precision — must NOT clobber the legitimate quality hedge

The Build-34 `IMAGE_DIRECTIVE` explicitly asks the model to *"say so plainly if an image is too low-quality to read, rather than inventing its contents."* That hedge is **correct behavior** and must survive. Three deliberate guards:

1. **Verb set is `see/view/access/open/display/perceive/process` — never `read` / `make out`.** "Too blurry to **read** the total" / "can't **make out** the number" is a quality hedge (it saw the image), not blindness.
2. **A clarity adverb between the negation and the noun breaks the match** — *"cannot **clearly** see the image"* deliberately does **not** match (it saw the image, just not sharply); a trailing clarity adverb (`(?!…clearly|well|properly…)`) does the same.
3. **`SAW_IMAGE_RE` veto** — any reply that demonstrably engaged with the image content is exempt regardless of other phrasing.

**Risk asymmetry that justifies the bias:** a false **positive** (replacing a borderline reply with the honest fallback) is *safe* — the fallback is still honest. A false **negative** (a real "I can't see images" slipping through) is the exact honesty bug we're closing. The guards above keep false positives off the *legitimate quality hedge* specifically, while biasing toward catching denial.

**Success-path only (load-bearing):** the throw path already returns `IMAGE_FALLBACK_RESPONSE`, whose own text ("can't view the image right now") matches `VISION_BLIND_RE` — running the guard there would relabel a *quota* failure as a *blind read*. The guard lives strictly in the `llm_done` success branch, never the catch. (Asserted by `vision-blind-verify.ps1`.)

## Files

- **`lib/orchestrator.js`** — `VISION_BLIND_RE` / `SAW_IMAGE_RE` / `IMAGE_BLIND_RESPONSE` constants (beside `IMAGE_FALLBACK_RESPONSE`); the guard in the `orchestrate()` success branch. `orchestrateStream` unchanged (image turns delegate to `orchestrate`).
- **`lib/buildState.js`** — Build-37 entry + commitFamily.
- **`tests/vision-blind-verify.ps1`** — PS mirror of both regexes + the `blind = VISION_BLIND && !SAW_IMAGE` decision.
- **`tests/BUILD37_LIVE_TEST.md`** — deployed-app scenarios (needs real Gemini + a degenerate image).

## Ship gate

1. **Offline:** `tests/vision-blind-verify.ps1` green (modality-denial / provide-request / absence / text-only all caught; quality hedges + real engagement + non-vision answers all pass through; "cannot clearly see" stays non-blind; success-path-only rationale asserted).
2. **No regression:** the Build-34 mirrors still green (`tests/image-attachment-verify.ps1`, `tests/attachment-verify.ps1`).
3. **Live (`BUILD37_LIVE_TEST.md`):** a near-blank/degenerate image that triggers a model "I can't see images" returns `IMAGE_BLIND_RESPONSE`, **and** a normal image still gets a real description, **and** a genuinely-blurry image still gets the legitimate quality hedge (not the fallback). The live pass is the real evidence — the offline mirror only proves the classifier.

## Honesty invariants (unchanged / reinforced)

- Narration ≤ evidence: a model that didn't see the image must not answer as if it did. Build-37 extends that from "no provider" (Build-34) to "provider answered blind."
- The guard is **deterministic** (regex over the model's own text) — code computes the verdict, no second LLM judge. Same doctrine as fleet/lean/chart/source-trust.
- Images remain THIS-turn-only — the guard reads only `response`, writes only `response`; no new state.
