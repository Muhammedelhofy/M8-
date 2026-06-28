# M8 Memory Audit — 2026-06-28

**By:** Stream 3 (Corpus + Hygiene) · **Read-only — DO NOT delete without Muhammad's explicit OK.**

---

## Tables surveyed

| Table | Rows | Scope |
|-------|------|-------|
| `m8_research_notes` | 766 | Math research threads (Collatz, Lean, Lychrel, etc.) |
| `m8_graph_nodes` | 182 | Math/research graph nodes |
| `m8_conversations` (memory_type IS NOT NULL) | subset of 4,609 | Operational + session memories |
| `m8_router_misses` | 7 | Routing logs from 2026-06-25 |

---

## Section 1 — Clean, no action needed

### `m8_research_notes` (766 rows) — KEEP ALL
All 766 rows belong to math research threads. No weather, price, or sports data found.

| Thread | Count | Content |
|--------|-------|---------|
| collatz-m3 | ~719 | Machine conjectures + status entries (M3-lite runs) |
| collatz | misc | Established collatz results, orbit properties |
| lychrel | misc | Lychrel number research |
| twin-primes | misc | Twin prime verification |
| sequence-analysis | misc | Sequence patterns |
| formalize-\* / lean / 2-steps / 3-steps | misc | Lean proof threads |
| general | misc | General math notes |

**Decision: KEEP ALL.** These are the intentional Track-B research corpus.

### `m8_graph_nodes` (182 rows) — KEEP ALL
All research nodes (conjecture, theorem, evidence, fact, etc.). These are the "~215 Collatz/Lean research facts" referenced in the system brief (count has evolved).

**Decision: KEEP ALL.**

### `m8_router_misses` (7 rows) — KEEP
Seven routing-miss log entries from 2026-06-25 live testing. These are Stream 1's training data for the V2 classifier. Pre-redacted (no personal info).

**Note:** RLS is disabled on this table — see Section 3.

---

## Section 2 — Stale / transient operational memories (flagged)

These are rows in `m8_conversations` with `memory_type = 'operational'`. They were correct when written but the data has expired or changed.

### 2A — Weather (2 keys, ~2–4 rows)

| memory_key | Stale because |
|------------|---------------|
| `current_temperature_in_riyadh` | Point-in-time temperature (42°C on 2026-06-24). Wrong now. |
| `alexandria_weather_june_8_2026` | Past-date weather snapshot. Irrelevant. |

**Recommendation: Safe to prune.**

### 2B — Sports scores (up to 10 keys, ~15–20 rows)

| memory_key | Stale because |
|------------|---------------|
| `world_cup_2026_england_ghana_score` | Live match score from 2026-06-23 (England 2–1 Ghana). Match over. |
| `world_cup_2026_portugal_uzbekistan_score` | Live score from 2026-06-23 (Portugal 5–0). Match over. |
| `brazil_egypt_match_result_june_6_2026` | Match result from 2026-06-06. Past. |
| `brazil_egypt_match_date_june_6_2026` | Past schedule entry. Past. |
| `premier_league_2023_2024_winner` | Season ended — historically correct but grows stale as context. |
| `premier_league_2023_24_winner` | Duplicate of above. |
| `saudi_pro_league_2025_26_champion` | Recent season result. |
| `saudi_pro_league_2025_26_winner` | Duplicate of above. |

**Borderline (probably fine to keep):**
- `portugal_world_cup_2026_contender` — general soccer context, still valid.
- `world_cup_2026_favorites` — general context, still valid.
- `world_cup_2026_final_date_and_venue` — stable event info.

**Recommendation: Safe to prune the 8 clear stale rows above; keep the borderline 3.**

### 2C — Live prices (3 keys, ~3–6 rows)

| memory_key | Stale because |
|------------|---------------|
| `tesla_stock_price_june_5_2026` | Stock price from 2026-06-05. Wrong today. |
| `cheapest_flight_riyadh_alexandria_august_2024` | 2024 flight price — 2 years old. |
| `cheapest_flight_riyadh_to_alexandria` | Old undated flight price. |

**Recommendation: Safe to prune all 3.**

### 2D — Date-stamped fleet snapshots (informational — do NOT prune)

Many operational keys follow patterns like:
- `bolt_fleet_net_earnings_june_N_2026` (June 1–6 individual day records)
- `fleet_data_june_6_2026`, `fleet_performance_metrics_june_6_2026`
- `mansour_daily_net_earnings_june_N_2026`, `abdulrahman_alshahrani_net_earnings_june_N`

These are historical fleet data records, not transient live snapshots. Muhammad may want them for trend queries ("what did the fleet earn on June 3?"). **Not flagged for deletion.**

---

## Section 3 — Security note (surfacing per Supabase advisor)

`m8_router_misses` has **RLS disabled**. Per the Supabase advisor:

> Anyone with the anon key can read or modify every row.

**Context:** The table is intentionally written from the browser-accessible `/api/ops` endpoint using the anon key (it logs pre-redacted routing misses — no personal data). This is by design.

**Muhammad decides** whether to add a restrictive policy (e.g. write-only from the Vercel origin). Do NOT enable RLS without adding policies first — it would block all access. Remediation SQL if needed:

```sql
ALTER TABLE public.m8_router_misses ENABLE ROW LEVEL SECURITY;
-- then add policy:
-- CREATE POLICY "allow_insert" ON m8_router_misses FOR INSERT WITH CHECK (true);
-- CREATE POLICY "allow_select" ON m8_router_misses FOR SELECT USING (true);
```

---

## Summary table

| Category | Count | Action |
|----------|-------|--------|
| Math research notes (m8_research_notes) | 766 rows | KEEP ALL |
| Math graph nodes (m8_graph_nodes) | 182 nodes | KEEP ALL |
| Weather memories | ~2–4 rows | Safe to prune |
| Stale sports scores | ~15–20 rows | Safe to prune |
| Old live prices | ~3–6 rows | Safe to prune |
| Date-stamped fleet snapshots | many rows | Keep — historical data |
| Router misses | 7 rows | Keep — V2 training data |

**Total stale rows worth pruning: ~20–30.** Muhammad decides when and if to run the cleanup.

### Prune SQL (run only with Muhammad's OK)

```sql
DELETE FROM m8_conversations
WHERE memory_type = 'operational'
  AND memory_key IN (
    'current_temperature_in_riyadh',
    'alexandria_weather_june_8_2026',
    'world_cup_2026_england_ghana_score',
    'world_cup_2026_portugal_uzbekistan_score',
    'brazil_egypt_match_result_june_6_2026',
    'brazil_egypt_match_date_june_6_2026',
    'premier_league_2023_2024_winner',
    'premier_league_2023_24_winner',
    'saudi_pro_league_2025_26_champion',
    'saudi_pro_league_2025_26_winner',
    'tesla_stock_price_june_5_2026',
    'cheapest_flight_riyadh_alexandria_august_2024',
    'cheapest_flight_riyadh_to_alexandria'
  );
```
