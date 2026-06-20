/**
 * M8 Track-A — lib/nudges.js  (Build-73)
 *
 * The driver-NUDGE lane: M8 turns the morning brief into ready-to-send Arabic
 * messages, one per driver, with the tone matched to how that driver is doing.
 * Muhammad reviews, tweaks, and sends them himself on WhatsApp (draft-only — M8
 * never messages a driver directly). The deterministic spine owns the NUMBERS
 * (each message is filled from real MTD data); the wording is fixed templates so
 * nothing is hallucinated and the Arabic is exactly as written.
 *
 * Buckets (tone by standing):
 *   welcome      — new driver (first active day within the last N days): onboarding
 *   urgent       — DROPPED YESTERDAY (was on pace, behind now): gentle alert + support
 *   awareness    — below target: motivation + the per-day pace needed
 *   keepItUp     — on track (projected >= target, not yet hit): encouragement
 *   appreciation — already past the target MTD: praise + blessing
 *   reEngage     — too few active days (not new): a light activity nudge
 *
 * CODE computes the standing + numbers; the message is a deterministic template.
 * Every export fails SAFE.
 */
const { getFleetRecord, decodeHistory, periodYMD, ymdKey, riyadhTodayYMD } = require("./fleet");
const { generateMorningBrief } = require("./morning-brief");
const { logNudge } = require("./nudge-logger");

const NEW_DRIVER_DAYS = Number(process.env.M8_NEW_DRIVER_DAYS || 7);
const TARGET_SAR      = Number(process.env.M8_DRIVER_TARGET   || 5000);
const WORKING_DAYS    = Number(process.env.M8_WORKING_DAYS    || 26);

const fmtMoney = (v) => (v == null ? "?" : Math.round(v).toLocaleString("en-US"));

// Arabic day-count agreement (Build-75): 1 -> يوم واحد, 2 -> يومين, 3-10 -> N أيام, 11+ -> N يوم.
function arabicDays(n) {
  const d = Math.round(n || 0);
  if (d === 1) return "يوم واحد";
  if (d === 2) return "يومين";
  if (d >= 3 && d <= 10) return `${d} أيام`;
  return `${d} يوم`;
}

function addDays(t, n) {
  const dt = new Date(Date.UTC(t.y, t.m, t.d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

// Earliest active day-key this month per driver (keyed by name.toLowerCase to
// match the brief items, which carry display names). Used for new-driver detection.
function firstActiveByDriver(entries, year, month, cutoffKey) {
  const first = new Map();
  for (const e of entries) {
    const p = periodYMD(e.period);
    if (!p || p.y !== year || p.m !== month) continue;
    const k = ymdKey(p);
    if (k > cutoffKey) continue;
    for (const d of (e.drivers || [])) {
      const name = (d.name || "").trim();
      if (!name) continue;
      const hadTrip = (d.orders || 0) >= 1 || d.isActive || (d.netEarnings || 0) !== 0;
      if (!hadTrip) continue;
      const key = name.toLowerCase();
      if (!first.has(key) || k < first.get(key)) first.set(key, k);
    }
  }
  return first;
}

// ── Arabic message templates (deterministic; numbers filled from real data) ────
function messageFor(bucket, d, brief) {
  const T = brief.target;
  const remainWork = Math.max(1, (brief.workingDays || WORKING_DAYS) - (d.daysOnline || 0));
  const perDay = Math.max(0, Math.ceil((T - (d.net || 0)) / remainWork));
  const daysLeft = d.daysLeft != null ? d.daysLeft : remainWork;
  switch (bucket) {
    case "welcome":
      return `حياك الله كابتن ${d.name} 🌟 من اليوم أنت رسمياً ضمن أسطولنا! تأكد إن حسابك البنكي محدّث عشان توصلك أرباحك بدون تأخير، وتابع هدفك الشهري (${fmtMoney(T)} ريال) عشان تحصل على المكافأة 🎯 جاهزين نبدأ، وبالتوفيق 🚗💨`;
    case "appreciation":
      return `ما شاء الله تبارك الله يا كابتن ${d.name} 👏 تجاوزت هدف الـ ${fmtMoney(T)} ريال وأنت من الأوائل هالشهر (${fmtMoney(d.net)} ريال). بارك الله في جهدك، واصل وأنت في القمة 🌟`;
    case "keepItUp":
      return `كابتن ${d.name}، أداؤك ممتاز 💪 وصلت ${fmtMoney(d.net)} ريال وأنت في طريقك للهدف (متوقع ${fmtMoney(d.projected)} ريال). استمر على نفس الوتيرة وتقفل الشهر فوق الـ ${fmtMoney(T)} بإذن الله 🚀`;
    case "awareness":
      return `كابتن ${d.name}، أنت حالياً عند ${fmtMoney(d.net)} ريال. للوصول لهدف الـ ${fmtMoney(T)} ريال تحتاج تقريباً ${fmtMoney(perDay)} ريال يومياً في الأيام المتبقية. قادر عليها، ولو تحتاج أي دعم إحنا معك 🤝`;
    case "urgent":
      return `كابتن ${d.name}، لاحظنا إن وتيرتك نزلت أمس بعد ما كنت في طريقك للهدف. باقي ${daysLeft} أيام وتقدر تعوّض اللي فات. وش يحتاج عشان نساعدك ترجع تنطلق؟ 🌟`;
    case "reEngage":
      return `كابتن ${d.name}، نشاطك هالشهر قليل (${arabicDays(d.daysOnline || 0)}). كل يوم على الطريق يقرّبك من هدف الـ ${fmtMoney(T)} ريال والمكافأة. موجودين لو تحتاج أي مساعدة 💪`;
    default:
      return "";
  }
}

// ── Bucket assignment (priority: welcome > urgent > appreciation/keepItUp > awareness > reEngage) ──
function buildNudges(brief, entries) {
  if (!brief || brief.note) return { nudges: [], note: (brief && brief.note) || "no brief" };
  const today = riyadhTodayYMD();
  const firstActive = firstActiveByDriver(entries, today.y, today.m, ymdKey(today));
  const newCutoff = ymdKey(addDays(today, -NEW_DRIVER_DAYS));
  const isNew = (name) => {
    const fk = firstActive.get((name || "").toLowerCase());
    return fk != null && fk >= newCutoff;
  };

  const assigned = new Map(); // nameLower -> { bucket, item }
  const put = (bucket, item) => {
    const key = (item.name || "").toLowerCase();
    if (!key || assigned.has(key)) return;
    assigned.set(key, { bucket, item });
  };

  // 1) NEW overrides everything (a new driver gets a welcome, not "below target").
  for (const d of brief.tooEarly)        if (isNew(d.name)) put("welcome", d);
  for (const d of brief.onTrack)         if (isNew(d.name)) put("welcome", d);
  for (const d of brief.below)           if (isNew(d.name)) put("welcome", d);
  for (const d of brief.droppedYesterday) if (isNew(d.name)) put("welcome", d);
  // 2) URGENT (dropped yesterday) — a dropped driver is also in below[]; urgent wins.
  for (const d of brief.droppedYesterday) put("urgent", d);
  // 3) appreciation (already hit) / keepItUp (on track, not yet hit).
  for (const d of brief.onTrack)         put(d.hit ? "appreciation" : "keepItUp", d);
  // 4) awareness (below target).
  for (const d of brief.below)           put("awareness", d);
  // 5) reEngage (too few active days, not new).
  for (const d of brief.tooEarly)        put("reEngage", d);

  const nudges = [...assigned.values()].map(({ bucket, item }) => ({
    name: item.name, bucket, net: item.net, projected: item.projected,
    message: messageFor(bucket, item, brief),
  }));
  return { nudges, month: brief.month, target: brief.target };
}

// ── Chat rendering (hard-return: M8 must not paraphrase the Arabic) ───────────
const BUCKET_META = {
  welcome:      { title: "👋 ترحيب — سائقين جدد",            order: 1 },
  urgent:       { title: "⚠️ تنبيه عاجل — انخفضوا أمس",       order: 2 },
  awareness:    { title: "📣 توعية وتحفيز — تحت الهدف",       order: 3 },
  keepItUp:     { title: "💪 استمر — في الطريق الصحيح",       order: 4 },
  appreciation: { title: "🌟 تقدير ودعاء — تجاوزوا الهدف",    order: 5 },
  reEngage:     { title: "🚗 نشاط — قليلي النشاط",           order: 6 },
};

function renderNudgesText(result) {
  if (!result || result.note) {
    const why = (result && result.note) || "sync the fleet dashboard first";
    return `No driver messages to draft yet — ${why}.`;
  }
  const { nudges } = result;
  if (!nudges || !nudges.length) return "No drivers to message right now.";
  const byBucket = {};
  for (const n of nudges) (byBucket[n.bucket] || (byBucket[n.bucket] = [])).push(n);
  const order = Object.keys(byBucket).sort((a, b) => BUCKET_META[a].order - BUCKET_META[b].order);

  const lines = [
    `Here are today's driver messages, Boss — ${nudges.length} drivers, grouped by how they're doing. ` +
    `Copy each one and send it on WhatsApp. They're drafts with each driver's real numbers — tweak freely before sending. ✏️`,
    "",
  ];
  for (const b of order) {
    lines.push(`──────── ${BUCKET_META[b].title} (${byBucket[b].length}) ────────`);
    for (const n of byBucket[b]) {
      lines.push(`▸ ${n.name}`);
      lines.push(n.message);
      lines.push("");
    }
  }
  lines.push("These use each driver's real MTD figures from the synced data — nothing invented. Edit any of them before you send.");
  return lines.join("\n");
}

// ── Nudge logging (Build-96) ──────────────────────────────────────────────────
// Each bucket maps to a human trigger_reason for the m8_nudge_log audit trail.
// CODE already knows WHY a driver got each tone (it assigned the bucket), so the
// reason is deterministic, not invented.
const TRIGGER_BY_BUCKET = {
  welcome:      "new driver - first active days",
  urgent:       "dropped below pace yesterday",
  awareness:    "below target pace",
  keepItUp:     "on track, not yet at target",
  appreciation: "passed monthly target",
  reEngage:     "too few active days",
};

// Log every drafted nudge to m8_nudge_log. Best-effort: awaited (so the inserts
// actually complete on serverless) but bounded by sbFetch's timeout and fully
// SAFE — a logging failure never changes or blocks the drafted messages. Re-asking
// for the drafts logs a fresh batch (each draft generation is its own event).
async function logNudgesSafe(result) {
  if (!result || !Array.isArray(result.nudges) || !result.nudges.length) return;
  try {
    await Promise.allSettled(result.nudges.map((n) =>
      logNudge(null, {
        driverName: n.name,
        toneBucket: n.bucket,
        messagePreview: n.message,
        triggerReason: TRIGGER_BY_BUCKET[n.bucket] || n.bucket,
        driverNetSar: n.net,
      })
    ));
  } catch (e) {
    console.error("[M8 nudges] log error (non-fatal):", e && e.message);
  }
}

async function computeNudges() {
  try {
    const record = await getFleetRecord();
    if (!record) return { nudges: [], note: "no fleet data synced yet" };
    const entries = decodeHistory(record);
    const brief = generateMorningBrief(entries);
    const result = buildNudges(brief, entries);
    await logNudgesSafe(result);            // Build-96: audit trail (fire-and-forget safe)
    return result;
  } catch (err) {
    console.error("[M8 nudges] compute error (non-fatal):", err.message);
    return { nudges: [], note: "error building messages" };
  }
}

// ── Request detection (English + Arabic) ──────────────────────────────────────
const NUDGE_RE = [
  /\bdraft\b[^.?!\n]{0,25}\b(nudges?|messages?|texts?|whatsapp)\b/i,
  /\b(write|compose|create|prepare|generate|send\s+me)\b[^.?!\n]{0,25}\b(messages?|nudges?|texts?)\b[^.?!\n]{0,20}\b(driver|captain|courier|fleet)/i,
  /\b(driver|captain|courier)s?\s+(nudges?|messages?|texts?)\b/i,
  /\bnudge\s+(the\s+)?(drivers?|captains?|couriers?)\b/i,
  /\bwhat\s+(should|do|can)\s+i\s+(tell|send|message|say\s+to|write\s+to)\b[^.?!\n]{0,20}\b(drivers?|captains?|couriers?)\b/i,
  /\bmessages?\s+(for|to)\s+(the\s+|my\s+)?(drivers?|captains?|couriers?)\b/i,
  /اكتب\s*رسائل|رسائل\s*(لل?كباتن|لل?سواقين|لل?سائقين|الكباتن|السواقين|السائقين)|وش\s*(أرسل|اكتب|اقول)\s*لل?(كباتن|سواقين|سائقين)|رسائل\s*تحفيز/i,
];
function detectNudgeRequest(message) {
  const s = message || "";
  return NUDGE_RE.some((re) => re.test(s));
}

module.exports = {
  detectNudgeRequest,
  computeNudges,
  buildNudges,
  renderNudgesText,
  messageFor,
  firstActiveByDriver,
  BUCKET_META,
  // Build-96 nudge logging:
  logNudgesSafe,
  TRIGGER_BY_BUCKET,
};
