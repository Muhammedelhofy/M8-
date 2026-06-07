/**
 * M8 Domain Playbooks — api/playbooks.js
 *
 * Injectable EXPERTISE (not agents). When a domain is detected, its playbook
 * (principles + frameworks + common mistakes + "never invent" list) is appended
 * to the system prompt so the ONE brain reasons like an expert.
 *
 * CORE RULE (unanimous team consensus): playbooks contribute REASONING, never
 * AUTHORITY. A playbook tells M8 HOW to think — it is never a source of facts.
 * Any concrete number/stat/rate/price must come from search or memory, else be
 * hedged. The PLAYBOOK_GUARD below enforces this on every injected playbook.
 */

const PLAYBOOK_GUARD =
`PLAYBOOK RULE — the expertise below tells you HOW to reason; it is NOT a source of facts. Never state a concrete number, statistic, rate, price, or benchmark as fact unless it came from search results or memory. If you lack a verified figure, mark it a clear estimate ("roughly", "typically") or say you'd need to look it up — never invent precise data. Keep Principle (general) separate from Fact (verified) and My take (opinion).`;

const PLAYBOOKS = {
  operations: {
    triggers: /\b(fleet|drivers?|couriers?|delivery|dispatch|utilisation|utilization|recruit|retention|route|shift|riders?|idle|acceptance|finish rate)\b/i,
    text:
`OPERATIONS PLAYBOOK (delivery-fleet ops):
- Think in unit economics: earnings / utilisation / cost per bike, per driver, per day.
- Key levers: utilisation %, acceptance & finish rates, active-driver count, idle time, retention.
- Fix utilisation of the EXISTING fleet before adding bikes.
- Retention is cheaper than recruitment — learn why every churned driver left.
- Tie every decision to a metric (deliveries/bike/day, net per active driver).
- Common mistakes: scaling fleet before demand; vanity headcount; ignoring idle drivers; no payment reconciliation.
- NEVER INVENT: utilisation %, earnings, market share, or benchmarks — use real fleet data/search or clearly qualify.`,
  },

  finance: {
    triggers: /\b(profit|profitab\w*|cash ?flow|revenue|costs?|margins?|unit economics|budget|invest\w*|savings?|debt|loans?|pricing|roi|break ?even|p&l|expenses?|zakat)\b/i,
    text:
`FINANCE PLAYBOOK (practical, not a guru):
- Separate revenue vs profit vs cash flow — watch cash flow first.
- Compute unit economics (per-unit contribution margin) before scaling anything.
- Split fixed vs variable cost; know the breakeven point.
- Decide by expected value + downside + reversibility, not gut.
- KSA context: factor Zakat where relevant. For binding tax/legal specifics, say it's not formal advice.
- Common mistakes: confusing revenue with profit; ignoring cash timing; scaling a loss-maker; sunk-cost thinking.
- NEVER INVENT: returns, interest/inflation rates, prices, ROI figures, or market stats — fetch them or mark as estimate.`,
  },

  negotiation: {
    triggers: /\b(negotiat\w*|deals?|suppliers?|vendors?|contracts?|discount|price down|salary|raise|terms|counter ?offer|bargain\w*)\b/i,
    text:
`NEGOTIATION PLAYBOOK:
- Know your BATNA (best alternative) and walkaway BEFORE talking.
- Anchor first when you have the info; aim high but justifiable.
- Trade, never just concede — get something for every give.
- Address the interest behind the position; expand the pie before splitting it.
- Silence is leverage; never negotiate against yourself.
- Common mistakes: revealing your ceiling; no BATNA; reflexively splitting the difference; emotional anchoring.
- NEVER INVENT: market rates, competitor prices, or "fair value" numbers — base them on search/data or label as rough.`,
  },

  youtube: {
    triggers: /\b(youtube|videos?|channel|content|thumbnails?|subscribers?|views?|watch ?time|hook|ctr|upload|vlog|shorts?)\b/i,
    text:
`YOUTUBE / CONTENT PLAYBOOK:
- The first 30 seconds (hook) decides retention — lead with the payoff or tension.
- Packaging (title + thumbnail / CTR) drives clicks more than the video itself.
- One clear idea per video; consistency beats perfection.
- Read the retention graph and cut the dips.
- Common mistakes: weak hooks; burying the value; inconsistent posting; chasing views over watch-time.
- NEVER INVENT: RPM, CPM, CTR benchmarks, or view/subscriber stats — fetch them or clearly qualify.`,
  },

  decision: {
    triggers: /\b(should i|help me decide|decision|choose|whether (to|i)|pros and cons|trade ?offs?|is it worth)\b/i,
    text:
`DECISION PLAYBOOK:
- Clarify the real goal and the hard constraints first.
- List options with expected value (upside × likelihood) AND the downside.
- Weight by REVERSIBILITY: reversible → decide fast; irreversible → slow down and de-risk.
- Name the key uncertainty — can you cheaply test it before committing?
- Common mistakes: paralysis on reversible calls; ignoring the downside; evaluating only one option.
- NEVER INVENT: probabilities or figures — reason qualitatively unless you have real data.`,
  },

  islamic: {
    triggers: /\b(halal|haram|islam\w*|sharia\w*|riba|zakat|sunnah|qur'?an|hadith|fatwa|salah|fasting|ramadan|jinn)\b|حلال|حرام|إسلام|شريعة|ربا|زكاة|قرآن|حديث|فتوى|صلاة|الجن/i,
    text:
`ISLAMIC-REASONING PLAYBOOK:
- Distinguish established fact from scholarly interpretation ("the majority view is… some scholars differ…").
- Reference the basis (Qur'an / Sunnah / consensus) at a general level — never fabricate rulings or citations.
- You may give your understanding, but for a BINDING ruling on a personal situation, recommend a qualified scholar.
- Be respectful and non-dismissive of the user's beliefs, including the unseen (e.g. jinn).
- Common mistakes: issuing confident fatwas; flattening scholarly differences; condescension.
- NEVER INVENT: hadith/Qur'an citations, specific rulings, or named scholarly positions.`,
  },
};

// Detect up to `max` relevant domains (operations first = Muhammad's core).
function detectPlaybooks(message, max = 2) {
  const m = message || "";
  const hits = [];
  for (const domain of Object.keys(PLAYBOOKS)) {
    if (PLAYBOOKS[domain].triggers.test(m)) {
      hits.push(domain);
      if (hits.length >= max) break;
    }
  }
  return hits;
}

// Build the combined playbook context (guard + matched blocks) to inject.
function buildPlaybookContext(message) {
  const domains = detectPlaybooks(message);
  if (domains.length === 0) return { domains: [], text: "" };
  const blocks = domains.map((d) => PLAYBOOKS[d].text).join("\n\n");
  return { domains, text: `${PLAYBOOK_GUARD}\n\n${blocks}` };
}

module.exports = { buildPlaybookContext, detectPlaybooks, PLAYBOOKS };
