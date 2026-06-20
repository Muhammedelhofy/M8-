# BUILD SPEC — Real Fleet P&L + Driver Cost Profiles

**Status:** DRAFT for Muhammad's approval · **Author:** Session C (Lane 3 — design/docs) · **Date:** 2026-06-19
**Type:** Written spec only — no code in this session. Approve / edit before any build lands.
**Update 2026-06-19:** Q1 + Q2 answered by Muhammad — Bolt bonus schedule + split now CONFIRMED (see §1c). P1 is unblocked.
**Lane note:** the implementation touches `lib/finance.js` (Lane 1 — BUSINESS). This file is design-only and changes nothing.

---

## 0. Why this spec exists (the core correction)

Today `lib/finance.js` computes per-driver P&L as:

```
netPnL = income + acctRent + carRent + salary + fleetCut + other
         ^^^^^^
         income = the driver's NET EARNINGS for the month
```

**This is the wrong mental model for most of the fleet.** Per the income model
([[bolt-income-model]]), **the driver's net earnings are the DRIVER's money, not the company's.**
Counting a rent-model driver's full net as company revenue overstates fleet profit by thousands of
SAR per driver.

The company actually earns from **two sources only**:

1. **Car / account rental income** — what the company charges the driver to use a company car and/or
   a company Bolt account. This is real company revenue.
2. **Bolt performance bonuses** — Bolt pays *the company* a bonus based on each driver's **monthly net
   tier**: ~4000 SAR net → base bonus, 5000 → higher, 6000 → top. *(This is why the Track-A morning
   brief targets 5000 — it's a bonus step, not an arbitrary goal. See [[m8-track-a-daily]].)*

The Bolt bonus is **completely absent** from the current model. That is the single biggest gap this
build closes.

> **One-line goal:** make M8's fleet P&L answer the question *"how much does the COMPANY actually keep
> this month, and from where?"* — rental income + Bolt bonuses − the company's own costs — instead of
> the current "driver net minus deal adjustments."

This is a **correctness rebuild of the finance spine**, not a new feature bolted on top. The deterministic
"code computes, LLM narrates" architecture stays exactly as-is; only the formula and its inputs change.

---

## 1. Data model — what we capture

### 1a. What already exists (reuse, don't rebuild)

From `lib/finance.js` / the dashboard's `khair_courier_profiles` + `khair_courier_overrides`
(effective-dated), each driver already has a deal profile:

| Field | Meaning | Reuse as |
|---|---|---|
| `model` | `S` Salaried · `F` Fleet-account · `R` Rent | **The deal type — drives the whole formula (see §2).** |
| `carRent` `{dir, amount}` | car rent, IN/OUT/NONE | **Rental income** (when `dir=IN`) |
| `accountRent` `{dir, amount}` | Bolt-account rent, IN/OUT/NONE | **Rental income** (when `dir=IN`) |
| `salary` / auto-salary (`salaryBase/Threshold/PerK`) | what the company PAYS a salaried driver | **Company cost** |
| `fleetCut` `{type:FLAT\|PCT, value}` | company's cut of the driver's earnings | **Company revenue** (model F mainly) |
| `other` `{label, dir, amount}` | misc IN/OUT | revenue or cost per `dir` |
| driver monthly `netEarnings` (from the blob) | the driver's Bolt net | **Tier input for the Bolt bonus** + the driver's own money |

So **the deal-level inputs already exist and are already synced.** No new per-driver sync is needed for them.

### 1b. What is NEW and must be captured

| Input | Scope | Why | Default if unknown |
|---|---|---|---|
| **Bolt bonus schedule** | Fleet-wide | The 4k/5k/6k tiers pay the company — currently unmodeled. | ✅ **CONFIRMED — see §1c.** |
| **Bonus split factor** | Fleet-wide | The Bolt bonus is **split with a helper/partner** — the company keeps only its share. | ✅ **CONFIRMED 50% — see §1c.** |
| **Bonus basis** | Fleet-wide | Per-driver vs fleet-aggregate; step vs cumulative. | ✅ **CONFIRMED: per-driver, step — see §1c.** |
| **Car fixed cost / month** | Per car (≈ per driver) | A company car has a real monthly cost (lease/finance, insurance, depreciation, maintenance). Rental income only becomes *profit* after this. | **None — ask.** Optional layer (see §2d); P&L can run without it (labeled "gross of car cost"). |
| **Fleet fixed overhead / month** | Fleet-wide | Office, admin, platform fees, etc. — turns fleet gross profit into net. | **0** + flag "no overhead set." |
| **Which drivers are on a company car vs own car** | Per driver | Only company cars carry a car fixed cost and (usually) car rent. | Infer from `carRent.dir=IN`; flag inferred. |

### 1c. Bolt bonus schedule — CONFIRMED (Muhammad, 2026-06-19)

The bonus is **per driver**, evaluated on each driver's **monthly net earnings**, as a **step** (you get the
amount for the tier reached, nothing extra above 6000, nothing below 4000):

| Driver monthly net | Bolt pays (GROSS) | Company share (after 50% helper split) |
|---|---|---|
| below 4000 | 0 | 0 |
| 4000–4999 | 1500 SAR | **750 SAR** |
| 5000–5999 | 2000 SAR | **1000 SAR** |
| 6000+ | 2500 SAR | **1250 SAR** |

- **Step, not cumulative** — a driver at 5,200 net earns the 5k tier only (gross 2000 / company 1000), NOT
  4k + 5k stacked.
- **Per driver** — every driver who reaches a tier earns it independently.
- **The split:** Bolt's bonus is shared with a helper/partner. Muhammad confirmed a flat **50% split on ALL
  three tiers** (2026-06-19) → company keeps 750 / 1000 / 1250.
- **The P&L must book the COMPANY SHARE (right column), not the gross.** M8 can still *show* the gross +
  "split with partner" so the line is transparent, but profit = the company share.
- **Tunable, not hardcoded:** stored as `{ tiers: [{floor, gross}], splitPctToCompany }` in the finance
  config so the amounts and split can change without a code edit.

**Storage:** a new fleet-level config object (Bolt bonus schedule + split + overhead) and an optional per-car cost
field. Recommended home = the **same `fleet_data` Supabase row** the dashboard already syncs (e.g. a new
`khair_finance_config` key for fleet-wide values, and an optional `carCost` field on each courier profile),
so M8 keeps its **one-source-of-truth, zero-new-sync** property. *(Assumption A4 — confirm storage location.)*

---

## 2. The P&L formula

### Principle: revenue depends on the DEAL MODEL

The fix is that **the driver's net earnings are only company revenue under the Fleet-account model**, where
the earnings land in the company's Bolt account and the company pays the driver a salary. Under Rent, the
driver keeps their own net and the company's revenue is *just the rent*.

#### 2a. Per-driver company revenue (by model)

Let `net` = driver's monthly Bolt net earnings (from the blob).

| Model | Company revenue from this driver | Company direct cost | Driver keeps |
|---|---|---|---|
| **R — Rent** | `carRent + accountRent` (the rent only) | car fixed cost (if company car) | their full `net` |
| **F — Fleet-account** | `net` (earnings land in company account) + any `fleetCut`/`other` IN | `salary` paid to driver + car fixed cost | the `salary` |
| **S — Salaried** | `net` (if earnings come to the company) **or** `fleetCut` (if not) — *needs confirm, see Q3* | `salary` + car fixed cost | the `salary` |

> **This is the heart of the correction.** Current code applies the model-F logic (`income + adjustments`)
> to *every* driver. The rebuild branches on `model` so a Rent driver's revenue is rent, not their whole net.

#### 2b. Bolt bonus (NEW — added on top, per driver)

```
grossBonusFor(net) =
    net >= 6000 ? 2500 :
    net >= 5000 ? 2000 :
    net >= 4000 ? 1500 :
    0
companyBonusFor(net) = grossBonusFor(net) * splitPctToCompany   // splitPctToCompany = 0.5
```

Values from the CONFIRMED schedule (§1c): gross 1500/2000/2500, **company share 750/1000/1250** after the
50% helper split. **Step function, not cumulative.** Bonus is company revenue regardless of deal model — it's
paid by Bolt to the company for the driver hitting the tier. **The P&L books `companyBonusFor(net)`** (the
right column); the gross may be shown for transparency but is not profit.

#### 2c. Per-driver P&L (the new formula)

```
driverRevenue = modelRevenue(model, net, carRent, accountRent, fleetCut, other)   // §2a
driverBonus   = bonusFor(net)                                                      // §2b
driverCost    = salaryOut + carFixedCost(if company car)                           // §1b + existing salary
driverPnL     = driverRevenue + driverBonus − driverCost
```

#### 2d. Fleet-wide P&L

```
fleetGrossProfit = Σ driverPnL  (all drivers)
fleetNetProfit   = fleetGrossProfit − fleetFixedOverhead
```

Report **both** a "before car/overhead costs" figure and an "after" figure, and **clearly label which costs
are real-config vs not-yet-set** (mirrors the existing honesty note for drivers with no profile). If car
fixed cost or overhead isn't set, the "after" line is shown as *"costs not fully configured — this is
revenue + bonus minus salaries only."* Never invent a car cost or overhead number.

#### 2e. Worked illustration (numbers are placeholders pending §3 intake)

> Rent driver, net 5,200 SAR, pays 1,500 car rent, company car costs 2,000/mo. At 5,200 net the driver hits
> the **5k tier** → gross bonus 2,000, **company share 1,000** (after the 50% split):
> revenue = 1,500 rent + 1,000 bonus = 2,500; cost = 2,000 car; **driver P&L = +500.**
> Contrast the *current* code: it would report ≈ 5,200 + 1,500 = 6,700 "profit" — overstated by ~6,200
> (the driver's own money **and** booking the gross instead of the company share, while missing the bonus
> source entirely).

---

## 3. Intake checklist — what M8 must ask Muhammad

A short, deterministic onboarding M8 runs (chat or a one-time form). **M8 must not compute the new P&L until
at least the bonus schedule is filled** — until then it falls back to the current (clearly-labeled "legacy")
view.

1. ✅ **Bolt bonus amounts — ANSWERED.** Gross 4k→1500, 5k→2000, 6k→2500; nothing below 4k, no extra above 6k.
2. ✅ **Bonus basis — ANSWERED.** Per-driver, step. **Split 50% with a helper** → company keeps 750/1000/1250.
   *(Still confirm A7: that the 50% split holds for 4k & 5k, not just the 6k figure given.)*
3. **Salaried/Fleet-account earnings flow** — for model S and F drivers, do the Bolt earnings land in the
   **company's** account (company revenue, pays driver a salary), or the driver's? ______
4. **Car fixed cost** — for company cars, approximate all-in monthly cost per car (finance/lease + insurance
   + maintenance/depreciation). One average, or per-car? ______
5. **Which drivers are on a company car vs their own?** (or: "all `carRent IN` drivers are company cars" —
   confirm.) ______
6. **Fleet fixed overhead** — monthly company overhead not tied to a single driver (office, admin, software).
   Rough monthly figure, or "none / negligible"? ______
7. **Bonus eligibility caveats** — does a driver need a minimum number of active days / acceptance / a full
   month to qualify for the Bolt bonus? ______

M8 stores the answers in the finance config (§1b) and confirms them back before first use.

---

## 4. Implementation plan — 3 builds

> Sequenced so value lands early and the risky correction is isolated and testable.

### Build P1 — Bonus engine + config (the missing revenue)
- Add the fleet finance config (`BONUS_T4/T5/T6`, basis flags, overhead) + the intake flow (§3 Q1–Q2, Q6).
- Implement `bonusFor(net)` and surface **"Bolt bonus this month"** as a new line in the existing fleet P&L
  packet — added *alongside* today's numbers, not replacing them yet.
- Pure functions + tests; no change to existing per-driver math yet. **Lowest risk, immediate new insight**
  (M8 can finally say how much bonus the fleet is earning and which drivers are one tier away).
- Ships the "pace to next tier" hook: for each driver, `SAR to next tier` and `bonus unlocked if reached`
  — directly reusable by the morning brief / nudges.

### Build P2 — Model-aware revenue (the correctness fix)
- Branch per-driver revenue on `model` (§2a) so Rent drivers no longer count their full net as company
  revenue. Add `carFixedCost` (§3 Q4–Q5) and the company-car flag.
- Replace `computeDriverPnL` / `computeFleetPnL` with the model-aware versions **behind a config switch**, so
  the legacy view stays available for side-by-side validation during rollout.
- Heavy test coverage: one golden case per model (S/F/R) + the §2e worked example. This is the build that can
  silently change every number, so it gets the most tests and an explicit before/after diff M8 shows Muhammad.

### Build P3 — Fleet roll-up, overhead & narration
- Fleet-wide gross→net with overhead (§2d), "revenue by source" (rental vs bonus vs cut), and the
  configured-vs-unset honesty labeling.
- Update the finance packet + the Excel/PPTX exports (`lib/fleet-analysis.js` / fleet-export) to show the new
  structure: revenue by source, bonus by tier, P&L by model, costs (salary/car/overhead).
- CFO-style narration instruction updated to the new model (no inventing COGS/fuel/etc — same honesty rule as
  today, new categories).

### Build-77 — Resilient Ingestion Endpoint (PARALLEL TRACK — knowledge/books)
- Hard-built (tested 33/33, deployed). Ships `/api/ingest-book` with resumable checkpoints + idempotent
  ingest. The endpoint exists but is **not wired** — chat command "ingest this as a book" still calls the old
  single-shot path that truncates at ~16k words. Migration applied; code is live.
- **Blocker resolved:** the infrastructure is ready. Next step is the wiring (Build-78).

### Build-78 — Wire Book-Ingest Flow to Resilient Endpoint (PARALLEL, UNBLOCKED)
- **The real fix:** route the chat command + PDF upload to call `/api/ingest-book` instead of the truncating
  legacy path (`buildKnowledgeIngestContext`).
- Make PDF→text OCR resumable too (persist text per page-batch so OCR survives timeouts, same pattern as
  Build-77). Root cause of silent truncation is both the wiring gap + fragile OCR.
- Wiring lives in `lib/orchestrator.js` (currently owned by Cleanup session). Flag as next-session build;
  **do NOT upload books yet** — they'll silently truncate without this wiring.
- Once wired: upload a book (PDF or text), confirm it persists end-to-end via `/api/knowledge-inventory`.

---

## 5. Open questions & assumptions (clearly marked)

**Assumptions made (flag for confirmation — built this way unless corrected):**
- **A1** — ✅ CONFIRMED: Bolt bonus is a **step** function (tier reached, not cumulative).
- **A2** — ✅ CONFIRMED: Bonus is **per-driver**, on each driver's monthly net.
- **A7** — ✅ CONFIRMED: the **50% helper split** applies to **all three tiers** → company 750/1000/1250.
- **A3** — A `carRent.dir = IN` profile implies a **company car** (so it carries a car fixed cost). *(Q5)*
- **A4** — New config lives in the **same `fleet_data` Supabase row** (one source of truth, no new sync).
- **A5** — Existing `salary` / `fleetCut` / `accountRent` semantics from the dashboard are correct and stay
  as-is; only their **aggregation** changes.
- **A6** — "Net earnings" from the blob is the right **tier input** for the bonus (matches what Bolt measures).
  *Verify the bonus is keyed off the same net figure Bolt reports, not gross or a different cycle.*

**Open questions:**
- **Q1** — ✅ ANSWERED. Gross 1500/2000/2500; company share 750/1000/1250 (§1c).
- **Q2** — ✅ ANSWERED. Per-driver, step, 50% helper split.
- **Q3** — For S/F drivers, do earnings flow to the **company** account or the driver's? Determines whether
  their `net` is company revenue or just the basis for `fleetCut`.
- **Q4** — Car fixed monthly cost (one average vs per-car). *(Blocks the "after costs" line in P2/P3; P&L can
  ship "before car cost" without it.)*
- **Q5** — Company-car vs own-car per driver.
- **Q6** — Fleet fixed overhead figure.
- **Q7** — Bonus eligibility caveats (min active days / acceptance / full month).
- **Q8** — Does the Bolt bonus arrive monthly, and is it ever clawed back / adjusted? (Affects whether it's
  booked in-month or on confirmation.)

**Honesty invariants (unchanged from today's finance spine):**
- Revenue/tier inputs = **measured** (the blob). Costs/bonus schedule = **Muhammad's config**. Never invent a
  rent, salary, car cost, overhead, or bonus amount.
- A driver/fleet with unset costs gets a P&L **labeled** "before/excluding the unconfigured cost," never a
  fabricated number.
- Code computes; the LLM only narrates the deterministic packet.

---

## 6. What this spec does NOT change
- The deterministic "code computes truth, LLM narrates" architecture.
- The dashboard's own P&L engine (this is M8-side; if Muhammad wants the dashboard to match, that's a separate
  follow-up).
- Per-driver deal profiles already in `khair_courier_profiles` — we read them, we don't redefine them.
- The driver's net earnings figure itself — it stays the driver's money; we just stop miscounting it as the
  company's.

---

*Approval block — Muhammad: ☐ approve as-is ☐ approve with the edits noted above ☐ discuss Q1–Q8 first.*
