# BUILD-37 LIVE TEST — Silent Vision-Miss Guard

Run on the **deployed app** (Vercel) once Build-37 is live. The classifier is proven
offline by `tests/vision-blind-verify.ps1` (20/20); these scenarios exercise the real
`/api/chat` vision path, which needs real Gemini + a deployed function. The whole point
is the **success-but-blind** case the Build-34 throw-only guard missed.

Prereqs: confirm the latest deploy is READY and on the Build-37 SHA. Build-37 builds on
Build-34 — keep `BUILD34_LIVE_TEST.md` scenarios green too (esp. #3, the legit hedge).

---

## 1. The target: near-blank / degenerate image (the silent miss)
- Attach an image that tends to make Gemini deny sight rather than hedge: a 1×1 / all-white
  / all-black / fully-noise PNG, or a corrupt-ish tiny image.
- Ask: **"What's in this image?"**
- PASS: M8 returns the honest `IMAGE_BLIND_RESPONSE` — *"I couldn't actually read that image
  — it may be blank, too low-quality, or it didn't come through… re-share it, or tell me
  what's in it."*
- FAIL: a model-authored *"I can't see images / please provide the image"* passes through
  verbatim, **or** a confabulated description of a blank image.

## 2. Normal image still works (positive control — no over-trigger)
- Attach a clear screenshot/photo with real content.
- Ask what it shows.
- PASS: M8 describes the actual content (the guard did **not** fire — `SAW_IMAGE_RE` / no denial).
- FAIL: the honest fallback fires on a perfectly readable image (false positive).

## 3. Genuinely blurry image still gets the LEGIT hedge (precision control)
- Attach a real but blurry/low-res photo of a document where *some* text is unreadable.
- Ask for the unreadable figure.
- PASS: M8 gives the **quality hedge** — "the image is too blurry to read the total / the
  bottom line is illegible" — i.e. it engaged with the image and said which part it can't read.
- FAIL: the guard wrongly replaces this with `IMAGE_BLIND_RESPONSE` (it should NOT — "read /
  blurry" is a quality hedge, not blindness; verb set excludes "read", and `SAW_IMAGE_RE` vetoes).

## 4. No downstream confabulation (the reason this matters)
- After scenario 1 (blind → fallback), in a **new** message ask: **"so what did that image say
  again?"**
- PASS: M8 does not invent contents — it reiterates it couldn't read the image / asks for a
  re-share. (The fallback was stored, not a blind/fabricated description, so there's nothing
  to confabulate from.)
- FAIL: M8 now states specific contents for the image it never read.

---

### Notes
- Build-37 changes only the **success path** of an image turn. The Build-34 throw path
  (every vision provider down → `IMAGE_FALLBACK_RESPONSE`, the quota message) is unchanged —
  and is deliberately NOT routed through this guard (its own text would look "blind").
- Server log marker on a catch: `vision_blind_miss` (one per fired guard) — grep the function
  logs to confirm it fired in scenario 1 and did NOT fire in 2/3.
