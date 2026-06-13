# Relabel Backfill Live Test — graph-label mid-number fix (Build-15 follow-up)

*One-time, idempotent backfill of historical graph-node labels. Offline already
green: `tests/graph-relabel-verify.ps1` 18/18 (scope guard) ·
`tests/graph-label-verify.ps1` 10/10 (smartTruncate unchanged).*

## Why this exists

The smartTruncate fix (`1409c5f`) was **forward-only**: it governs labels at
write time (`ingestNote`) and at the three recall render sites. But the render
sites smartTruncate the **stored label**, and for pre-fix nodes that label is
*already* the dumb `content.slice(0,160)` string ending mid-number (e.g.
`"2 <= n <= 10"` for content `"...2 <= n <= 10,000..."`). `smartTruncate(brokenLabel,200)`
is a no-op (160 <= 200), so old nodes still narrate the WRONG bound in recall.
The full figure survives in `content`, so we re-derive the label from it.

**Scope guard (the load-bearing safety property):** only nodes whose label is a
literal prefix of `content` are rewritten — exactly the dumb-truncation
signature. Extraction paraphrases, curated LITERATURE titles (`"Author Year: ..."`,
content begins `"[LITERATURE ...]"`) and thread anchors (`"Research thread: ..."`)
are NOT content prefixes and are left untouched. Only `label` + its `norm_label`
dedup key change; `content` / `status` / `metadata` / `embedding` / edges are
never touched — display-only, retrieval-neutral.

## 0. PRE-REQ — confirm the deploy is live (per the deploy-readiness lesson)

Vercel project `m8` (`m8-alpha.vercel.app`) auto-deploys `main`. Before trusting
any result below, confirm the deployment is **READY** and its commit SHA matches
the relabel commit. A dry-run that hits the old build is a false negative.

`CRON_SECRET` bearer is required only if it is set on the project (it is — cron
uses it). Set it once for the session:

```powershell
$H = @{ Authorization = "Bearer <CRON_SECRET>" }   # omit -Headers $H if CRON_SECRET is unset
$U = "https://m8-alpha.vercel.app/api/graph-relabel"
```

## 1. DRY RUN — look before you write (read-only, safe)

```powershell
Invoke-RestMethod $U -Headers $H | ConvertTo-Json -Depth 6
```

- [ ] `mode: "dry-run"`, `ok: true`.
- [ ] `scanned` ~= total live nodes; `changed` = the count it WOULD repair.
- [ ] `samples[]` — eyeball several `{old, new}` pairs. Every `old` should be a
      blunt 160-char cut (often ending mid-number); every `new` should end at a
      clean word/number boundary with an ellipsis, never on a partial figure.
- [ ] `skipped_not_prefix` > 0 and **rising with the literature/extraction nodes**
      — that is the scope guard correctly *declining* to touch curated titles and
      paraphrases. If this is 0 while external seeds exist, STOP and investigate.
- [ ] `skipped_collision` should be 0; if not, inspect `collisions[]` before
      applying (a (kind, norm_label) clash is skipped, never forced).

## 2. APPLY — commit the changes

```powershell
Invoke-RestMethod "$U`?apply=1" -Method POST -Headers $H | ConvertTo-Json -Depth 6
```

- [ ] `mode: "apply"`, `ok: true`, `changed` == the dry-run's `changed`.
- [ ] `errors: 0`.

## 3. RE-RUN DRY — prove idempotency

```powershell
Invoke-RestMethod $U -Headers $H | ConvertTo-Json -Depth 4
```

- [ ] `changed: 0` now — every label already equals `smartTruncate(content,160)`.
      `skipped_already_ok` rose by the number just fixed. A second apply is a no-op.

## 4. CHAT RECALL — the real user-facing proof

Type into live chat (`m8-alpha.vercel.app`), a question that surfaces a node that
was previously truncated mid-figure (an M1 stopping-time census is the canonical
one):

**Type:** `what do we know about collatz stopping times?`

- [ ] The census node now narrates the **full bound** (e.g. `10,000`) or cleanly
      omits it — it must NEVER show a misleading partial like `tested to 10`.
- [ ] Provenance labels unchanged: LITERATURE seeds still cited to their authors,
      MACHINE-GENERATED survivors still tested-to-N — the relabel touched display
      text only, not kinds/status/edges.

## Safety / rollback

Non-destructive by construction: `content` is never modified, so the fix can be
re-derived at any time and a re-run cannot make things worse. There is no delete
or content mutation to undo. If a specific `{old,new}` pair ever looks wrong,
it can be corrected directly in Supabase — the authoritative text is still in
that node's `content`.
