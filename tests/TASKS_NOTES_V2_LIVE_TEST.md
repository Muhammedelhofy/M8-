# LIVE TEST — Notes tab + edit/snooze/recurring + edit-expense (batch 2)

Run on prod after deploy. Refresh/reopen the installed PWA so the new files load.

## Notes tab (browse + delete)
- ••• menu → **Notes** → see your saved notes; tap **✕** to delete one.
- Capture/recall still via chat: "note: gate code 4417" → it appears in the tab.
- Chat delete: "delete note about gate code" → removes it (or lists matches if ambiguous).

## Tasks — per-task work/personal + edit (already shipped) + recurring
- Add row: tap the **P/W** pill to choose the new task's category.
- Tap a task's **name** → rename + flip W/P → **✓** save.
- Mark done = tap **○**; delete = **✕**.
- Recurring (chat): "remind me to **pay rent every month**" → adds with a **🔁** tag;
  "standup **every day**", "water plants **every sunday**". Completing it spawns the next one.
- Snooze (chat): "snooze groceries to tomorrow" / "push the report 3 days" / "move X to friday".

## Edit an expense (M8's own last entry only)
- After adding one via M8 (e.g. "add 30 sar lunch" → yes), say:
  "change the last expense to 35" or "fix the last expense category to Fuel" → confirm → "yes".
- ⚠️ This is the FIRST live use of the wallet UPDATE grant — round-trip-audit it:
  confirm the change in Family Wallet + an `edit_expense` row in `m8_wallet_writes`.
  If it returns "couldn't update", the role's UPDATE may need a tweak — tell me.

## Regression
- Money add-expense + spend queries unchanged. Fleet/chat not hijacked. No console errors.
- Function count still 12/12 (notes endpoint folded into ops).
