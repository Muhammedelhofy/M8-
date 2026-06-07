/**
 * M8 Domain Playbooks — api/playbooks.js
 *
 * NOT separate agents — injectable EXPERTISE (per GPT/Grok/Gemini consensus).
 * When a domain is detected, its playbook (principles + frameworks + common
 * mistakes) is appended to the system prompt so the ONE brain reasons like an
 * expert. Deterministic, zero extra LLM calls, no new infrastructure.
 */

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
- Common mistakes: scaling fleet before demand; vanity headcount; ignoring idle drivers; no payment reconciliation.`,
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
- Common mistakes: confusing revenue with profit; ignoring cash timing; scaling a loss-maker; sunk-cost thinking.`,
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
- Common mistakes: revealing your ceiling; no BATNA; reflexively splitting the difference; emotional anchoring.`,
  },

  youtube: {
    triggers: /\b(youtube|videos?|channel|content|thumbnails?|subscribers?|views?|watch ?time|hook|ctr|upload|vlog|shorts?)\b/i,
    text:
`YOUTUBE / CONTENT PLAYBOOK:
- The first 30 seconds (hook) decides retention — lead with the payoff or tension.
- Packaging (title + thumbnail / CTR) drives clicks more than the video itself.
- One clear idea per video; consistency beats perfection.
- Read the retention graph and cut the dips.
- Common mistakes: weak hooks; burying the value; inconsistent posting; chasing views over watch-time.`,
  },

  decision: {
    triggers: /\b(should i|help me decide|decision|choose|whether (to|i)|pros and cons|trade ?offs?|is it worth)\b/i,
    text:
`DECISION PLAYBOOK:
- Clarify the real goal and the hard constraints first.
- List options with expected value (upside × likelihood) AND the downside.
- Weight by REVERSIBILITY: reversible → decide fast; irreversible → slow down and de-risk.
- Name the key uncertainty — can you cheaply test it before committing?
- Common mistakes: paralysis on reversible calls; ignoring the downside; evaluating only one option.`,
  },

  islamic: {
    triggers: /\b(halal|haram|islam\w*|sharia\w*|riba|zakat|sunnah|qur'?an|hadith|fatwa|salah|fasting|ramadan|jinn)\b|حلال|حرام|إسلام|شريعة|ربا|زكاة|قرآن|حديث|فتوى|صلاة|الجن/i,
    text:
`ISLAMIC-REASONING PLAYBOOK:
- Distinguish established fact from scholarly interpretation ("the majority view is… some scholars differ…").
- Reference the basis (Qur'an / Sunnah / consensus) at a general level — never fabricate rulings or citations.
- You may give your understanding, but for a BINDING ruling on a personal situation, recommend a qualified scholar.
- Be respectful and non-dismissive of the user's beliefs, including the unseen (e.g. jinn).
- Common mistakes: issuing confident fatwas; flattening scholarly differences; condescension.`,
  },
};

// First match wins; operations is checked first (Muhammad's core domain).
function detectPlaybook(message) {
  const m = message || "";
  for (const domain of Object.keys(PLAYBOOKS)) {
    if (PLAYBOOKS[domain].triggers.test(m)) return { domain, text: PLAYBOOKS[domain].text };
  }
  return null;
}

module.exports = { detectPlaybook, PLAYBOOKS };
