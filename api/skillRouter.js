/**
 * M8 Skill Router — api/skillRouter.js
 *
 * Detects which domain expertise modules are relevant to the current message
 * and builds a context block to inject into the system prompt.
 * Zero LLM cost — pure substring matching, same approach as intentClassifier.
 */
const SKILLS = require('./skills/index');

function detectSkills(message) {
  if (!message || typeof message !== 'string') return [];
  const lower = message.toLowerCase();
  return SKILLS.filter(skill =>
    skill.keywords.some(kw => lower.includes(kw.toLowerCase()))
  );
}

function buildSkillContext(skills) {
  if (!skills.length) return '';
  return '\n\n' + skills
    .map(s => `--- DOMAIN SKILL: ${s.name} ---\n${s.context}`)
    .join('\n\n');
}

module.exports = { detectSkills, buildSkillContext };
