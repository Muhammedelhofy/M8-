/**
 * M8 Artifact Generator — api/docgen.js
 *
 * Doc/presentation generation as an ARTIFACT pipeline (per team consult):
 *   Template (fixed structure)  →  LLM fills CONTENT only  →  Markdown out
 * The LLM never invents structure or layout; code owns the skeleton. Frontend
 * handles export (Copy / Download-PDF / pptxgenjs) — backend just returns text.
 */
const { generate } = require("./llm");

const TEMPLATES = {
  one_page_plan:  { type: "doc",  title: "One-Page Plan",   sections: ["Goal", "Current State", "Actions", "Timeline", "Risks"] },
  brief:          { type: "doc",  title: "Brief",           sections: ["Executive Summary", "Background", "Key Points", "Recommendation", "Next Steps"] },
  meeting_summary:{ type: "doc",  title: "Meeting Summary", sections: ["Date & Attendees", "Discussion", "Decisions", "Action Items"] },
  action_plan:    { type: "doc",  title: "Action Plan",     sections: ["Objective", "Steps", "Owners & Deadlines", "Resources Needed", "Success Metrics"] },
  deck_brief:     { type: "deck", title: "5-Slide Brief",   sections: ["Title", "Current Situation", "The Problem", "Recommendation", "Next Steps"] },
  deck_proposal:  { type: "deck", title: "Proposal Deck",   sections: ["Title", "Executive Summary", "Current State", "Problems", "Proposed Solution", "Plan & Timeline", "Next Steps"] },
};

// Deterministic template choice from the request (no LLM needed).
// Deck-type detection uses only the first 200 chars (the explicit command) so
// a pasted brief that mentions "deck" or "presentation" in context doesn't
// silently flip a document request into a deck.
function planArtifact(message) {
  const m = (message || "").toLowerCase();
  const mHead = m.length > 200 ? m.slice(0, 200) : m;
  if (/\b(deck|slides?|presentation|pitch|power ?point|ppt)\b/.test(mHead)) {
    return /\bproposal\b/.test(m) ? "deck_proposal" : "deck_brief";
  }
  if (/\b(meeting|minutes|notes)\b/.test(m))                 return "meeting_summary";
  if (/\b(action plan|action-plan|to-?do|checklist)\b/.test(m)) return "action_plan";
  if (/\bbrief\b/.test(m))                                   return "brief";
  return "one_page_plan"; // sensible default for "plan"/"document"/unspecified
}

async function generateArtifact({ message, history, memoryBlock }) {
  const key = planArtifact(message);
  const tpl = TEMPLATES[key];
  const isDeck = tpl.type === "deck";

  const structure = isDeck
    ? tpl.sections.map((s, i) => `Slide ${i + 1}: ${s}`).join("\n")
    : tpl.sections.map((s) => `## ${s}`).join("\n");

  const system =
`You are M8 producing a ${tpl.title} for Muhammad El-Hofy — operations manager in Riyadh (Bolt KSA bike fleet, courier supply for Hunger Station/Noon/Keeta/Uber, YouTube, AI).
Fill EXACTLY this ${isDeck ? "slide" : "section"} structure — do not add, remove, or rename ${isDeck ? "slides" : "sections"}:
${structure}

Rules:
- Concrete, specific content tailored to his request and context. No filler, no "[insert here]" placeholders.
- ${isDeck ? "Each slide = a short bold title line, then 3-5 tight bullets." : "Each section = 2-5 tight lines or bullets."}
- Output CLEAN MARKDOWN ONLY. Start with a single "# " title line.${memoryBlock ? "\n- Use the RELEVANT MEMORY for personalization where it fits." : ""}`;

  const userMsg = memoryBlock
    ? `Request: ${message}\n\nRELEVANT MEMORY:\n${memoryBlock}`
    : `Request: ${message}`;

  const markdown = await generate({
    systemInstruction: system,
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    providerOrder: process.env.DOC_PROVIDER_ORDER || "gemini,gemini2,groq,cerebras,openrouter",
    genConfig: { temperature: 0.5, maxOutputTokens: 3000 },
  });

  return { artifact: key, type: tpl.type, title: tpl.title, markdown };
}

module.exports = { generateArtifact, TEMPLATES };
