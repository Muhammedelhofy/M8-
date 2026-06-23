# LIVE TEST — Task/Note/Money front door (assistant-architecture build #2)

Run on prod after deploy. Notes live in `m8_notes` (BOLT Supabase), a SEPARATE store
from tasks — they never appear in the Tasks tab.

## Notes — explicit capture (instant)
- "note: the wifi password is hunter2" → "📝 Noted."
- "remember the car service is due at 90,000 km" → "📝 Noted."
- "jot down parking spot B12" → "📝 Noted."
- AR: "ملاحظة: المفتاح عند الجيران" → "📝 سجّلتها."

## Notes — recall (read, no LLM)
- "my notes" → numbered list of recent notes.
- "notes about wifi" / "what did I note about the car" → only matching notes.
- AR: "ملاحظاتي" / "ملاحظاتي عن السيارة".

## Free-form front door (confirm-gated)
- "call the landlord tomorrow" → "✅ Looks like a task — add it? (yes / work / no)".
  - reply "work" → lands in the Tasks tab under WORK, due tomorrow.
  - reply "yes" → personal; reply "no" → nothing saved.
- "Omar owes me 30 sar" → "📝 Looks like a note — save it? (yes/no)" → yes saves it.
- AR: "اتصل بسارة بكرة" → task offer; "علي عليه ٢٠٠ ريال" → note offer.

## Must NOT be hijacked (fall through to normal chat / their own lanes)
- Questions: "what's the capital of France?" → normal answer (no offer).
- Fleet/brief commands: "send me the brief", "submit the fleet report",
  "nudge the drivers" → their own lanes, NOT a task offer.
- "get me the June numbers" → fleet/chat, NOT a task offer.
- Explicit money still confirms as an expense: "spent 30 sar on lunch" → expense gate.
- "remember to call mom" / "don't forget to pay rent" → a TASK (not a note).

## Privacy / regression
- Money expenses unchanged (wallet lane runs before notes). Tasks tab unchanged.
- No console errors.
