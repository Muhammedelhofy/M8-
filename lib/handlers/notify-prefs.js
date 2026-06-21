/**
 * M8 Hands — GET /api/notify-prefs  (Build-70)
 *
 * The unsubscribe / resubscribe link target for the morning-brief email. A wrong
 * or missing token is a no-op (anti-tamper). Returns a tiny HTML confirmation page
 * so clicking the link in the email gives visible feedback. Fails SAFE.
 *
 *   /api/notify-prefs?action=unsubscribe&token=XXXX  → turns the daily email OFF
 *   /api/notify-prefs?action=resubscribe&token=XXXX  → turns it back ON
 */
const { setEnabledByToken } = require("../notify");

function page(title, msg, color) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title></head>` +
    `<body style="font:16px/1.5 system-ui,Arial;max-width:520px;margin:60px auto;padding:0 20px;color:#111">` +
    `<h2 style="color:${color}">${title}</h2><p style="color:#444">${msg}</p>` +
    `<p style="color:#888;font-size:13px;margin-top:30px">M8 Fleet — you can also say "resume the morning email" or "stop the morning email" in chat.</p>` +
    `</body></html>`;
}

module.exports = async function handler(req, res) {
  const action = (req.query.action || "unsubscribe").toString();
  const token = (req.query.token || "").toString();
  const enable = action === "resubscribe" || action === "subscribe";

  try {
    const result = await setEnabledByToken(token, enable);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (!result.ok) {
      return res.status(400).send(page("Link not recognised",
        "That unsubscribe link is invalid or expired. Nothing was changed.", "#b45309"));
    }
    if (enable) {
      return res.status(200).send(page("Morning email resumed",
        "You will receive the daily fleet brief again at 6 AM Riyadh.", "#15803d"));
    }
    return res.status(200).send(page("Morning email stopped",
      "You will no longer receive the daily fleet brief by email. The brief is still available any time in M8 chat.", "#b91c1c"));
  } catch (e) {
    console.error("[M8 notify-prefs] error:", e.message);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(page("Something went wrong", "Please try again later.", "#b91c1c"));
  }
};
