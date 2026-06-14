# BUILD-34 LIVE TEST — Image / Vision Chat Attachments

Run on the **deployed app** (Vercel) once Build-34 is live. The frontend ingest
(downscale, chip, thumbnail, reject) was already verified in the local preview;
these scenarios exercise the **backend `/api/chat` vision path** that needs real
Gemini + a deployed function.

Prereqs: confirm the latest deploy is READY and on the Build-34 SHA before trusting any result.

---

## 1. Screenshot understanding (general vision)
- Attach a screenshot (📎 button, drag-drop, or paste) of any app/dashboard.
- Ask: **"What does this screen show?"**
- PASS: M8 describes what's actually in the image (real elements/labels), not a generic guess.
- FAIL: vague answer that could apply to any screenshot, or "I can't view images."

## 2. Read text from a document / receipt (the main use case)
- Attach a photo or screenshot of a receipt/invoice/printed doc with clear numbers.
- Ask: **"What's the total on this receipt?"** (or "list the line items").
- PASS: M8 reads the **actual** figures/text correctly.
- FAIL: invented numbers, or numbers that don't match the image.

## 3. Low-quality / unreadable image
- Attach a blurry or tiny image where text is genuinely unreadable.
- Ask what it says.
- PASS: M8 says it can't read it clearly / names which part is unreadable.
- FAIL: confidently makes up the contents.

## 4. Image + text file together (mixed attachments)
- Attach one image AND one .csv/.txt in the same message; ask a question touching both.
- PASS: M8 uses both — reads the file text AND sees the image.

## 5. Honest refusal when vision is unavailable (hard to force)
- If Gemini's free image quota is exhausted (or to simulate, temporarily unset
  `GEMINI_API_KEY`/`GEMINI_API_KEY_2` and leave no `OPENAI_API_KEY`):
- PASS: M8 returns the honest line — *"I can't view the image right now … try again later or describe it in text"* — and does **NOT** describe the image.
- FAIL: a fabricated description (would mean an image turn reached a text-only model).

## 6. Memory / routing isolation (negative control)
- After an image turn, in a **new** message ask: "what did we just talk about?"
- PASS: M8 recalls the conversation topic but the image content was NOT silently
  stored as fleet/research data; intent classification was unaffected (the image
  never entered baseMessage/memory/routing — same isolation as text attachments).

---

### Notes
- Images are downscaled in the browser to ≤1600px long edge (PNG kept crisp for
  text, photos → JPEG), capped ~4 MB, max 3 attachments/turn.
- Image turns are forced onto a vision-capable provider order
  (`gemini,gemini2[,openai]`); text-only fallbacks (Groq/Cerebras/Mistral/
  OpenRouter-Llama) are excluded so an image is never silently dropped.
- Images live in THIS turn's LLM context only — never memory, intent, routing,
  the research graph, or fleet/finance packets.
