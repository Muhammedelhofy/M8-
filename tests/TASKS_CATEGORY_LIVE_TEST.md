# LIVE TEST — Tasks work/personal category (assistant-architecture build #1)

Run on prod after deploy (m8-alpha.vercel.app). Tasks live in the BOLT Supabase.

## Tasks tab
1. Open Tasks (•••  → Tasks). You should see an **ALL / WORK / PERSONAL** filter bar
   under the add row. ALL is active by default.
2. With **WORK** selected, the input placeholder reads "Add a work task…". Add one →
   it shows an amber **WORK** tag on the row.
3. Switch to **PERSONAL** → only personal tasks show; new adds have no tag.
4. **ALL** shows both. Toggling tabs is instant (no reload / no flicker).
5. Existing (pre-migration) tasks all appear under PERSONAL (back-filled default).

## Chat lane (EN)
- "add work task submit the fleet report" → "Added to your work list: …". Confirm it
  appears under WORK in the tab with the amber tag.
- "add personal task call the landlord tomorrow" → personal, due tomorrow.
- "remind me to buy milk" → personal (no category said).
- "show my work tasks" → lists only work tasks.
- "finish the work report" → marks a task done (must NOT be mis-read as a category).

## Chat lane (AR)
- "أضف مهمة عمل ارسل التقرير" → adds a WORK task "ارسل التقرير".
- "أضف مهمة شخصية اتصل بأمي" → adds a PERSONAL task.
- "مهامي" / "وش عندي" → lists tasks.

## Privacy / regression
- Money + notes lanes unchanged. "add 30 sar lunch" still confirm-gates as money.
- No console errors on the Tasks panel.
