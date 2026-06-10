/**
 * M8 Company Registry — lib/companies.js
 *
 * Operator-assistant breadth (multi-company): M8 used to assume EVERY business
 * question was about the Bolt driver fleet (the system prompt persona + the fleet
 * spine are Bolt-shaped). As Muhammad runs more than one company (Bolt 3PL today;
 * Thrivve.sa / Noon / others), M8 must reason about each SEPARATELY and never
 * carry Bolt's fleet numbers onto a different company.
 *
 * This is the context layer: a registry of his companies (sector, role, model,
 * key facts, and an optional data source linking to the deterministic spine).
 * When a non-Bolt company is named, or a cross-company question is asked, the
 * relevant context/roster is injected — additive, like a playbook (it does NOT
 * suppress search/router), so the normal pipeline still answers.
 *
 * HONESTY (load-bearing): only Bolt is PROFILED here, from verified facts. Other
 * companies are registered BY NAME but UNPROFILED — M8 must say it doesn't have
 * their details and ASK, never invent a sector/role/data for them. The registry
 * is a seed; richer per-company facts accrue through the normal memory spine, and
 * a company's dataSource.row can later point the fleet/finance spine at its own
 * Supabase row (fetchFleetRecord/getFleetRecord already take a rowId).
 */

const FLEET_ROW = (process.env.FLEET_ROW_ID || "fleet").trim();

const COMPANIES = [
  {
    id: "bolt",
    name: "Bolt fleet",
    primary: true,
    profiled: true,
    sector: "3PL last-mile delivery — a Bolt driver fleet (drivers also run Uber + food platforms: HungerStation, Keeta, Noon)",
    role: "Managing Director — owns and runs the fleet",
    location: "Riyadh, Saudi Arabia",
    model: "Driver accounts on Salaried / Fleet-account / Rent deals; fleet revenue = driver net earnings collected + account/car rent + fleet cut; costs = salaries / rent / fleet cut / other.",
    // Bolt is NOT solo-injected (the fleet/finance spine already owns its turns);
    // it appears in the cross-company ROSTER only.
    soloAlias: null,
    dataSource: { type: "supabase_fleet", row: FLEET_ROW },
  },
  {
    id: "thrivve",
    name: "Thrivve.sa",
    primary: false,
    profiled: false,
    location: "Saudi Arabia",
    sector: null, role: null, model: null,
    soloAlias: /\bthrivve(?:\.sa)?\b/i,
    dataSource: null,
  },
  {
    id: "noon",
    name: "Noon",
    primary: false,
    profiled: false,
    sector: null, role: null, model: null,
    // Bare "noon" is usually the delivery PLATFORM the fleet works for, not a
    // company of his — so only fire on an explicit company qualifier, and always
    // disambiguate.
    soloAlias: /\b(?:my\s+noon|noon\s+(?:company|venture|business))\b/i,
    note: "Noon is ALSO a delivery PLATFORM the Bolt fleet delivers for — disambiguate whether Boss means a Noon company/venture of his or the platform before answering.",
    dataSource: null,
  },
];

const byId = new Map(COMPANIES.map((c) => [c.id, c]));
function getCompany(id) { return byId.get(id) || null; }
// The fleet_data Supabase row for a company (for the company-addressable spine).
function companyDataRow(id) {
  const c = byId.get(id);
  return c && c.dataSource && c.dataSource.type === "supabase_fleet" ? c.dataSource.row : null;
}

// Cross-company / "my companies" question → inject the roster.
const MULTI_RE = /\b(my\s+companies|all\s+(?:my\s+)?(?:companies|businesses|ventures)|across\s+(?:my\s+)?(?:companies|businesses|ventures)|which\s+(?:of\s+my\s+)?(?:compan|business)|other\s+(?:compan|business)|each\s+(?:of\s+my\s+)?(?:compan|business)|company\s+(?:breakdown|comparison|roster)|between\s+my\s+(?:compan|business))\b/i;
function isMultiCompanyQuery(message) { return MULTI_RE.test(message || ""); }

// A specific NON-primary company named as a subject (Bolt is handled by the spine).
function detectCompany(message) {
  const s = message || "";
  for (const c of COMPANIES) {
    if (c.soloAlias && c.soloAlias.test(s)) return c;
  }
  return null;
}

// ── packets (additive context; honest about what M8 does/doesn't know) ─────────
function renderCompany(c) {
  if (c.profiled) {
    return [
      `COMPANY CONTEXT — ${c.name}: ${c.sector}. Boss's role: ${c.role}.${c.location ? " Based in " + c.location + "." : ""}`,
      c.model ? `Model: ${c.model}` : "",
      c.dataSource ? `Live data is available via the fleet/finance spine — answer its metrics from there, not from memory.` : "",
      `Reason about ${c.name} on its OWN facts; do NOT mix in another company's numbers.`,
    ].filter(Boolean).join("\n");
  }
  // Unprofiled: known by name only — never invent its details.
  return [
    `COMPANY CONTEXT — ${c.name} is one of Boss's companies, but you do NOT have its profile yet (no sector, role, business model, or data on record).`,
    `Do NOT invent what ${c.name} is, how it's doing, or Boss's role in it, and do NOT carry the Bolt fleet's numbers onto it. Tell Boss you know it's one of his companies but you don't have its details yet, and ASK him to fill you in (what it does, his role, any data source) — once he tells you, it's remembered.`,
    c.note ? `IMPORTANT: ${c.note}` : "",
    `You MAY share general PUBLIC information about ${c.name} if you genuinely know it or can search it — but clearly separate that from his INTERNAL specifics, which you don't have.`,
  ].filter(Boolean).join("\n");
}

function renderRoster() {
  const lines = COMPANIES.map((c) => {
    if (c.profiled) return `• ${c.name} — ${c.sector}; Boss is ${c.role}; LIVE data via the fleet/finance spine.`;
    return `• ${c.name} — registered, profile NOT filled in yet (no details/data on record — ask Boss)${c.note ? "; " + c.note : ""}.`;
  });
  return [
    `COMPANY ROSTER — Boss's companies M8 knows about:`,
    ...lines,
    `Reason about each company SEPARATELY using only its OWN facts. Do NOT conflate them, do NOT carry Bolt's fleet numbers onto another company, and do NOT invent details or performance for the unprofiled ones — say you don't have them and ask.`,
  ].join("\n");
}

// ── orchestrator entry point (additive — like a playbook, no suppression) ──────
function buildCompanyContext(message) {
  const s = message || "";
  if (isMultiCompanyQuery(s)) return { text: renderRoster(), company: null, mode: "roster" };
  const c = detectCompany(s);
  if (c) return { text: renderCompany(c), company: c.id, mode: c.profiled ? "company" : "company_unprofiled" };
  return { text: "", company: null, mode: null };
}

module.exports = {
  buildCompanyContext, detectCompany, isMultiCompanyQuery,
  getCompany, companyDataRow, COMPANIES,
  renderCompany, renderRoster,
};
