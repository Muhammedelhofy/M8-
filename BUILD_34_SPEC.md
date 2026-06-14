# BUILD_34 SPEC — Image / Vision Chat Attachments
**Status:** SPEC ONLY — no code yet
**Session:** Session-31 / 2026-06-15
**Prerequisite:** Build-33 (text/CSV attachments ✅, `dc5a358`) + Build-33b (attach-file UI + empty-search guard ✅, `619fa18`)
**Why now:** the second half of Muhammad's earlier "Both" choice (text files + images). The attach-file UI, chip system, and `attachments` payload plumbing already exist — Build-34 reuses all of it and adds the one thing that's different about images: they go to the model as **binary parts**, not text.

---

## The core architectural fact (drives everything below)

M8's LLM adapter (`lib/llm.js`) sends `contents: [{ role, parts: [{ text }] }]` and has a **multi-provider fallback chain**: Gemini → Gemini2 → Groq → Cerebras → OpenRouter → Mistral → OpenAI → Grok.

- **Gemini** (`gemini-1.5-flash`, the default) **is vision-capable** — it accepts image parts of the form `{ inlineData: { mimeType, data: <base64> } }`. No new account, no paid key.
- **Every non-Gemini fallback** (`generateOpenAICompatible`, `generateAnthropic`) currently builds its message with `(c.parts||[]).map(p => p?.text || "").join("")` — it reads **only text parts and silently drops anything else.** Most of them (Groq/Cerebras/Mistral/OpenRouter-Llama) are **text-only models** and can't see images at all.

**⇒ The load-bearing honesty risk:** if an image turn falls through to a text-only provider (e.g. Gemini hit its daily quota), the image is silently dropped and the model answers *as if it saw an image it never received* — the exact failure class as the Brazil-vs-Morocco fabrication we just fixed in Build-33b. **Build-34 must restrict image turns to vision-capable providers and refuse honestly when none is available, never silently answer blind.**

---

## Scope (v1)

A user attaches an image (paste / 📎 picker / drag-drop — all three already wired in Build-33b) and asks about it. M8 actually sees the image and answers. That's it — general vision Q&A (describe it, read text in it, answer a question about it). **No** OCR-to-fleet-data, **no** image generation, **no** persisting images to memory/graph. Images live in **this turn only**, exactly like text attachments.

---

## Changes by layer

### 1. Frontend — `js/app.js`
- New `isImageAttachment(file)` (MIME `image/png|jpeg|webp|gif`). `ingestFiles()` branches: text → existing path; image → read as **data URL** (`FileReader.readAsDataURL`), then **downscale client-side** via a `<canvas>` to max ~1024px long edge + re-encode JPEG ~0.85 (keeps payloads small → fast, free, no Vercel timeout). Queue as `{ name, kind:'image', mimeType, data }` (base64, no `data:` prefix).
- Chip renders a small **thumbnail** for images (vs the 📎 text chip).
- Drop the Build-33 "only text/CSV supported" rejection for images; keep it for genuinely unsupported types (e.g. PDF, video) — those stay a polite "not supported yet."
- `packAttachments()` passes `kind/mimeType/data` through for image entries; text entries unchanged.
- Caps: `MAX_IMAGE_BYTES` (~4 MB post-downscale), reuse `MAX_ATTACHMENTS=3` total.

### 2. Wire — `api/chat.js`, `api/chat-stream.js`
- No shape change needed; they already forward `attachments`. (They pass the whole array through.)

### 3. Orchestrator — `lib/orchestrator.js`
- `withAttachments()` already prepends fenced **text** files to the final user turn's text. Add a sibling that, for **image** attachments, pushes `{ inlineData:{ mimeType, data } }` **parts** onto that same final user `contents` entry (alongside the text part). Images never touch `baseMessage`/`effectiveMessage` (intent, memory, routing) — identical isolation to Build-33.
- New `hasImageAttachments(attachments)` gate. When true:
  - **Force a vision-capable provider order** for this turn (e.g. `gemini,gemini2` + `openai` only if `OPENAI_API_KEY` is set — gpt-4o-mini is vision; Groq/Cerebras/Mistral/OpenRouter-Llama are excluded). Pass it as the per-call `providerOrder` so the existing chain logic is reused.
  - Append an `IMAGE_DIRECTIVE` to `systemInstruction` ("the user attached image(s); describe/answer from what you actually see; if the image is unreadable say so").
  - If **no** vision provider is available/healthy (all cooled down or no key) → **honest refusal** ("I can't view the image right now — Gemini's image quota may be used up; try again later or describe it in text"). **Never** fall through to a text-only model with the image dropped.

### 4. LLM adapter — `lib/llm.js`
- Gemini paths (`generateGeminiWith`, `generateStream`) already pass `contents` straight to the SDK → `inlineData` parts work with **zero change**.
- `generateOpenAICompatible`: when a part has `inlineData`, translate to an OpenAI `image_url` content block (`data:<mime>;base64,<data>`) **only for `openai`** (gpt-4o-mini vision); for the text-only providers this path won't be reached because the orchestrator excludes them from the image-turn `providerOrder`. (Defensive: if an image part reaches a text-only provider anyway, throw rather than silently drop — surfaces as a fail-over, not a blind answer.)

### 5. Streaming
- Gemini streams image turns fine (`inlineData` in `contents`). The buffered fallback inherits the same forced vision-provider order. No SSE protocol change.

---

## Honesty invariants (must hold)
1. An image turn **never** silently downgrades to a text-only model — vision provider or honest refusal, nothing in between.
2. Images go into **this turn's `contents` only** — never memory, intent classification, routing, the research graph, or fleet/finance packets.
3. Vision output is ordinary LLM narration (not deterministic ground truth) — M8 must not treat numbers it "reads" off an image as verified fleet/finance data (that's a separate, later build if ever).
4. No image is persisted server-side; it lives in the request and is gone after the turn.

---

## Tests
- Offline `tests/attachment-verify.ps1` extended (or new `tests/image-attachment-verify.ps1`): `isImageAttachment` classification, image part-building shape, the vision-provider-order restriction, the no-vision-provider refusal path. (PS mirror — no Node in this shell.)
- `tests/BUILD34_LIVE_TEST.md`: on the deployed app — (a) attach a screenshot + "what does this show?" → real description; (b) attach a photo with text → reads it; (c) force the quota-exhausted path if feasible and confirm the honest refusal, not a fabricated description.

---

## Open product decisions (for Muhammad — see chat)
1. **Primary use** — what will you mostly attach images *for*? (screenshots of dashboards/Bolt, photos of paper documents/receipts, general "what is this", a mix). Shapes whether v1 needs to lean into reading text-in-images (OCR-ish) vs general description.
2. **Downscale** — auto-shrink large photos in the browser before sending (recommended: faster, free, avoids timeouts) vs send full resolution.
3. **Model** — keep the free Gemini stack for vision (recommended) — no paid key, no new account.
