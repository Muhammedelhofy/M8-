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

  // Placed 2nd (right after operations) ON PURPOSE: legal is the highest
  // fabrication-risk domain, so with the max-2 detector it must never be dropped
  // when it matches — at worst it's the 2nd pick, so it's always injected.
  legal: {
    triggers: /\b(saudi\s+labou?r|labou?r\s+law|employment\s+law|saudi[sz]ation|nitaqat|\bgosi\b|iqama|work\s+permits?|kafala|sponsorship|qiwa|mudad|wage\s+protection|\bwps\b|end[\s-]?of[\s-]?service|\beosb\b|gratuity|notice\s+period|labou?r\s+court|wrongful\s+termination|commercial\s+registration|\bcr\b|company\s+(formation|registration|setup)|companies\s+law|\bllc\b|\bmisa\b|foreign\s+(invest\w*|owner\w*)|\bzatca\b|commercial\s+law|legal(?:ly)?\s+(requirement|require|obligation|oblig|complian|allowed|liable|binding)|labou?r\s+(?:contract|dispute|rights?)|terminate?\s+(?:an?\s+)?(?:employee|driver|worker|staff))\b|نظام\s*العمل|السعودة|نطاقات|التأمينات\s*الاجتماعية|إقامة|قوى|حماية\s*الأجور|نهاية\s*الخدمة|السجل\s*التجاري|الاستثمار\s*الأجنبي|هيئة\s*الزكاة|مكتب\s*العمل/i,
    text:
`KSA LEGAL & REGULATORY PLAYBOOK (orientation, NOT legal advice — labour / commercial / company law in Saudi Arabia):
- YOUR ROLE: give Muhammad a clear, useful ORIENTATION — which area of law applies, which regulator/platform owns it, the key considerations, and where to verify or who to ask. You are NOT his lawyer and this is NOT formal legal advice; say so when it matters.
- MAP the topic to the AUTHORITY + OFFICIAL SOURCE and point him there for the binding detail:
  · Employment / labour → Ministry of Human Resources & Social Development (MHRSD) under the Saudi Labour Law; day-to-day on the Qiwa platform (contracts, work permits, Saudization).
  · Saudization → the Nitaqat programme (colour bands set by sector + company size) via Qiwa.
  · Social insurance → GOSI. · Wage payment → the Wage Protection System (WPS) / Mudad.
  · Company setup & commercial registration → Ministry of Commerce (the CR); foreign-investment licence → MISA.
  · Tax / Zakat / VAT → ZATCA. · Disputes → the Labour Courts / the relevant committee.
- FRAMEWORK vs CURRENT FIGURES — keep them apart and say which is which. The STRUCTURE (which law, which regulator, the general mechanism) is durable — explain it confidently. SPECIFIC CURRENT NUMBERS — Nitaqat band thresholds/percentages, GOSI contribution rates, the exact end-of-service formula, notice-period days, fines/penalties, fees, the VAT rate, processing times, specific article numbers — CHANGE, and you must NOT state them from memory. Give the mechanism, then say the exact current figure must be confirmed on the official source (or search for it and cite it).
- END-OF-SERVICE / NOTICE / TERMINATION: explain the general mechanism (the award accrues with tenure; resignation vs employer-termination changes entitlement; fixed-term vs unlimited-term contracts differ), but do NOT assert the exact multiplier, day count, or a computed amount as settled law — flag that it depends on contract type + the current Labour Law text, and offer to compute it once the inputs and the current rule are confirmed.
- ESCALATE (do not play lawyer): drafting or signing a binding contract, an actual termination / dispute / grievance, liability or penalty exposure, a specific filing, or anything with real money or legal consequence → recommend a licensed Saudi lawyer or the official authority. Inform and prepare him; never hand down a ruling.
- Common mistakes: treating a remembered figure as the current law; ignoring contract-type (fixed vs unlimited) differences; missing that the Saudization band depends on sector + size; assuming other-country / generic GCC rules apply in KSA.
- NEVER INVENT: article numbers, Nitaqat percentages/thresholds, GOSI rates, end-of-service amounts, notice-period days, fines, fees, or processing times. If it isn't verified, say so and point to Qiwa / MHRSD / GOSI / Ministry of Commerce / MISA / ZATCA — or search for the current figure and cite it.`,
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

  recruitment: {
    triggers: /\b(hire|hiring|recruit\w*|candidates?|interview\w*|screening|onboard\w*|talent|applicants?|staffing|job (post|ad))\b/i,
    text:
`RECRUITMENT PLAYBOOK:
- Define the role's must-have OUTCOMES before sourcing — hire for the result, not the CV.
- Widen the top of funnel (referrals, local hubs, social), then screen ruthlessly for the 2-3 non-negotiables.
- Speed wins talent: short time-to-offer; slow processes lose the best people.
- Structure interviews (same questions + scorecard) to cut bias and gut-calls.
- Onboarding is part of hiring — a fast, clear first week drives retention.
- Common mistakes: vague role specs; hiring on likability; slow process; no track-record check; no onboarding.
- NEVER INVENT: salary benchmarks, market pay rates, or applicant numbers — verify or clearly qualify.`,
  },

  sales: {
    triggers: /\b(sales|selling|sell\b|clients?|business development|\bbd\b|pipeline|leads?|prospect\w*|acquire (customers|clients)|grow revenue|outreach|cold (call|email)|partnerships?)\b/i,
    text:
`SALES / BUSINESS-DEVELOPMENT PLAYBOOK:
- Sell outcomes and ROI, not features — lead with the buyer's problem.
- Qualify hard (budget, authority, need, timing) before investing time.
- Work the pipeline by stage; always know the next step and a target close date.
- Make the ask, then follow up persistently — most deals die from silence, not "no".
- Build trust for repeat + referral business, not one-off wins.
- Common mistakes: pitching before qualifying; talking more than listening; no follow-up; chasing unqualified leads.
- NEVER INVENT: conversion rates, deal sizes, or market figures — base on data/search or label as rough.`,
  },

  project: {
    triggers: /\b(projects?|roadmap|milestones?|deadlines?|deliverables?|sprint|execution|delegate|prioriti[sz]e|kickoff|scope creep|gantt|timeline)\b/i,
    text:
`PROJECT-MANAGEMENT PLAYBOOK:
- Start from the outcome + a hard deadline; work backwards into milestones.
- One owner per task, a due date, and a clear "done" definition — no orphan tasks.
- Prioritise by impact × urgency; cut or defer the rest (guard against scope creep).
- Short feedback loops: weekly check-ins, unblock fast, surface risks early.
- Delegate outcomes, not steps — and follow up on what you delegate.
- Common mistakes: no single owner; vague "done"; scope creep; no risk plan; over-planning instead of shipping.
- NEVER INVENT: effort estimates or costs as fact — present them as estimates to refine.`,
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
