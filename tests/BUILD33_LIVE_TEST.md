# Build-33 Live Test — Text/CSV chat attachments

Build-33 lets you paste a text-like file (`.txt`/`.csv`/`.tsv`/`.json`/`.md`/
`.markdown`/`.log`/`.yaml`/`.yml`, or any `text/*`/`application/json` clipboard
item) directly into the M8 chat box. The file's content is shown to M8 for
that turn only — never saved to memory, never used for routing/intent.

This is the deployed-app test (needs `/api/chat` and `/api/chat-stream`
running, i.e. on Vercel — local `serve.ps1` is static-only).

## Test 1 — paste a small CSV, ask a question about it

1. Copy a few lines of CSV to your clipboard, e.g.:
   ```
   date,net,orders
   8 Jun,1200.50,40
   9 Jun,1340.00,44
   10 Jun,980.25,35
   ```
2. Click into the M8 chat textarea and paste (Ctrl+V).

**Expect:**
- A chip reading `📎 <something>.csv` (or `clipboard.txt`/similar — clipboard
  paste often has no real filename) appears in a bar just above the input.
- The textarea itself is NOT filled with the CSV text.

3. Type "what's the total net across these days?" and send.

**Expect:**
- Your sent message shows the typed text plus a small attachment chip
  underneath it.
- M8's reply correctly sums the net column (1200.50 + 1340.00 + 980.25 =
  3520.75) — i.e. it actually read the pasted file, and does NOT say it
  can't view attachments.

## Test 2 — send with no typed text

1. Paste the same CSV again (chip appears).
2. Press send/Enter with the textarea EMPTY.

**Expect:**
- A default prompt ("Please take a look at the attached file." / Arabic
  equivalent) is sent as the visible user message, with the attachment chip
  under it, and M8 responds about the file's content.

## Test 3 — remove a pending attachment before sending

1. Paste a file (chip appears).
2. Click the `×` on the chip.

**Expect:** chip disappears, the bar above the input hides again, and
sending a plain text message afterwards has no attachment chip.

## Test 4 — cap at 3 files

1. Paste 4 different small text files in a row.

**Expect:** only 3 chips ever show; a brief status message says the max
(3) has been reached for the 4th.

## Test 5 — unsupported file (image)

1. Copy a screenshot/image to the clipboard and paste it into the chat box.

**Expect:** no chip appears; a brief status message says only text/CSV files
are supported for now (this is the Build-34 gap — image attachments are not
yet implemented).

## Negative control — memory/intent unaffected

After Test 1, ask in a NEW message: "what's our fleet net this week?"

**Expect:** normal fleet rollup, completely unrelated to the pasted CSV —
confirms the attachment text didn't leak into routing or get saved as a
persistent fact.
