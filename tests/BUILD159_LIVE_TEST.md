# Build-159 — FINISH THE ALL-DOMAIN FLIP + currency backlog — live phone test

**What changed (two things):**

1. **JOB 1 — the LAST CRUD lanes onto the registry (tasks / notes / driver_profile).**
   When the capability registry CLEARLY decides a turn is tasks / notes / driver_profile but every
   deterministic keyword parser missed the phrasing, M8 now **rescues** it with that lane's "here's how
   to phrase it" card instead of a blind chat answer. The keyword parsers still run FIRST and win on the
   phrasings they parse — this only catches the misses. Behind **`M8_REGISTRY_CRUD=1`** (default **OFF**
   = byte-for-byte unchanged). A no-action chat turn ("what are my tasks in life") is **never** stolen.

2. **JOB 2 — currency-filtered breakdown (handler fix, always on).**
   `breakdown on 921 sar` now decomposes **only the SAR** expenses (was: a SAR+EGP mix). Distinct from
   `… in sar` which still CONVERTS everything into one currency.

**Offline mirror:** `tests/build159_finish_crud.test.ps1` → **48/48 pass** (Node is absent on the host;
PS-5.1 mirror). Regression suite 152/153/155/156/157 still green (6/6). Privacy wall untouched — no
figure leaves M8; JOB 2 only changes which rows are summed.

---

## 1) JOB 2 — currency-filtered breakdown (works on deploy, NO flag needed)

Ask a wallet total first so "breakdown" has a figure to point at, then:

| # | Type exactly | PASS = | FAIL (the old bug) = |
|---|---|---|---|
| 1 | `what's my spend this month` then `what's the breakdown on 921 sar` | a category breakdown with **only SAR** rows | a mix that shows `… EGP` rows / an EGP total |
| 2 | `breakdown of the 3440 egp` | **only EGP** rows | SAR rows mixed in |
| 3 | (contrast) `put all currency in sar` | every category **converted** into SAR + one SAR total | (unchanged — this is the convert lane, not the filter) |

> The number you name picks the currency: "**on 921 _sar_**" ⇒ SAR-only; "**3440 _egp_**" ⇒ EGP-only.
> A bare "in sar" with **no number** is still the convert lane (everything expressed in SAR).

## 2) JOB 1 — tasks / notes / driver_profile rescue  (set `M8_REGISTRY_CRUD=1` first)

These only fire for phrasings the keyword parser misses, so test slightly off-beat wordings:

1. `update Ahmad's salary` (no amount) → the **driver-profile** help card ("I can set/update a driver's
   rental, salary, or fuel…"), NOT a generic chat reply.
2. `remind me to update the car registration` → the **tasks** card (add/complete/delete tasks…).
3. `fyi, set the alarm for the vehicle inspection` → the **notes** card (save/recall notes…).

**Must NOT be stolen (still a normal chat answer):**
- `what are my main tasks in life` → a real answer, **not** the tasks card (no action verb).
- `any interesting notes from the lecture` → a real answer, **not** the notes card.

**Must stay money-safe (the privacy-critical invariant):**
- `total net earning per driver from 1st to 28th of june` → fleet numbers, **never** a wallet/task/note
  card.

## 3) How to confirm the routing (optional)

In Diagnostics / `m8_router_misses`: a rescued turn logs reason `registry_crud_rescue` with lane =
`task` / `note` / `driver_profile`. A fleet/finance turn never logs a money or CRUD card.

## 4) Kill switches

- **JOB 1** is behind `M8_REGISTRY_CRUD` (Vercel env var). Remove it / set `=0` → the CRUD rescue is
  gone, byte-for-byte pre-159. (Same flag B-157 introduced for the wallet/fleet/finance flip.)
- **JOB 2** is an always-on handler fix (no flag). To revert, the change is isolated to
  `parseBreakdownCurrencyFilter` + the `currencyFilter` arg on `getCategoryBreakdown`.
