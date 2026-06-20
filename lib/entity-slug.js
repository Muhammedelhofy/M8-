"use strict";

/**
 * lib/entity-slug.js — Build-90: canonical entity slugs (script-agnostic).
 *
 * WHY a consonant skeleton rather than a literal transliteration: Arabic script
 * omits short vowels, so "Ahmad" in Arabic carries none while the Latin
 * "Ahmad"/"Ahmed" do, and "Mohammed"/"Muhammad" differ only in vowels. The only
 * key that lands all of these on one slug is the consonant skeleton -- drop vowels
 * and collapse doubled letters on both sides. We also strip the Arabic article
 * "al-" (alef+lam) and fold the romanization digraphs (kh/sh/gh/th/dh) so the
 * Arabic spelling of "Riyadh" matches "Riyadh" and "Khalid" matches its Arabic form.
 *
 * Matching is pure slug-equality (never fuzzy / edit-distance): two names merge
 * only when their skeletons are byte-identical. Trade-off: names that differ only
 * by a vowel (Dana/Dina) also collapse -- inherent to vowel-insensitive matching
 * and required by the spec's own Mohammed==Muhammad / Ahmad==Ahmed cases.
 *
 * Pure Node: zero dependencies, zero network / DB / LLM. Arabic is written with
 * \u escapes (pure-ASCII source) so the map can never be silently re-encoded.
 */

const TASHKEEL = /[ؐ-ًؚ-ٟ]/g;
const VOWELS   = /[aeiou]/g;

const AR2LAT = {
  "أ": "a",  "إ": "a",  "ا": "a",  "آ": "a",  // alef forms
  "ٱ": "a",  "ء": "",   "ئ": "y",  "ؤ": "w",  // wasla, hamza, hamza-carriers
  "ب": "b",  "ت": "t",  "ث": "th", "ج": "j",
  "ح": "h",  "خ": "kh", "د": "d",  "ذ": "dh",
  "ر": "r",  "ز": "z",  "س": "s",  "ش": "sh",
  "ص": "s",  "ض": "d",  "ط": "t",  "ظ": "z",
  "ع": "a",  "غ": "gh", "ف": "f",  "ق": "q",
  "ك": "k",  "ل": "l",  "م": "m",  "ن": "n",
  "ه": "h",  "و": "w",  "ي": "y",  "ى": "a",  "ة": "a",
};

const DIGRAPHS = [["dh", "d"], ["th", "t"], ["kh", "k"], ["sh", "s"], ["gh", "g"]];

const ALIF = 0x0627, LAM = 0x0644;

function toSlug(name) {
  if (name == null) return "";
  const original = String(name);
  let s = original.toLowerCase().replace(TASHKEEL, "");

  // Strip the leading Arabic definite article alef+lam so "al-Riyadh" == "Riyadh".
  if (s.length > 2 && s.charCodeAt(0) === ALIF && s.charCodeAt(1) === LAM) {
    s = s.slice(2);
  }

  let mapped = "";
  for (const ch of s) {
    mapped += Object.prototype.hasOwnProperty.call(AR2LAT, ch) ? AR2LAT[ch] : ch;
  }
  s = mapped;

  for (const [from, to] of DIGRAPHS) s = s.split(from).join(to);

  s = s.replace(VOWELS, "");        // consonant skeleton
  s = s.replace(/(.)\1+/g, "$1");   // collapse doubled letters
  s = s.replace(/[^a-z0-9\s-]/g, "");
  s = s.trim().replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
  s = s.slice(0, 80);

  if (!s) {
    // Skeleton emptied the name (e.g. all-vowel) -- fall back to a plain
    // alphanumeric slug so we never return "" (which would merge everything).
    s = original.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  return s;
}

function slugsMatch(a, b) {
  const sa = toSlug(a);
  return sa.length > 0 && sa === toSlug(b);
}

function findCanonical(name, existingNames) {
  if (name == null || !Array.isArray(existingNames)) return null;
  const target = toSlug(name);
  if (!target) return null;
  for (const existing of existingNames) {
    if (existing != null && toSlug(existing) === target) return existing;
  }
  return null;
}

module.exports = { toSlug, slugsMatch, findCanonical };
