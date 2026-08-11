const { Resend } = require("resend");

let getStoreSafe = null;
try {
  const { getStore } = require("@netlify/blobs");
  getStoreSafe = function (name) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
    return siteID && token ? getStore({ name, siteID, token }) : getStore({ name });
  };
} catch (_) {
  // Rate limiting falls back to origin and payload validation.
}

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";
const ALLOWED_HOSTS = new Set(["nibing.uy", "www.nibing.uy"]);
const LOGO_URL = "https://nibing.uy/logo.webp";
const BRAND_GREEN = "#0b6b44";
const YELLOW = "#ffd400";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function clean(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function escapeHtml(value) {
  return clean(value, 2000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requestHost(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const referer = event.headers?.referer || event.headers?.Referer || "";
  for (const value of [origin, referer]) {
    try {
      if (value) return new URL(value).hostname.toLowerCase();
    } catch (_) {}
  }
  return "";
}

async function enforceDailyLimit(event) {
  if (!getStoreSafe) return true;

  const forwarded = clean(event.headers?.["x-forwarded-for"] || "unknown", 100);
  const ip = forwarded.split(",")[0].trim().replace(/[^a-z0-9:._-]/gi, "_");
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}/${ip}.json`;

  try {
    const store = getStoreSafe("challenge-winner-submissions");
    const existing = await store.get(key, { type: "json" });
    if (existing?.submitted) return false;
    await store.setJSON(key, { submitted: true, at: new Date().toISOString() });
  } catch (error) {
    console.warn("Challenge winner rate limit skipped:", error.message);
  }

  return true;
}

function buildWinnerEmailHtml({ name, binType, preferredDate }) {
  const firstName = escapeHtml(String(name || "there").trim().split(/\s+/)[0] || "there");
  const safeBin = escapeHtml(binType);
  const safeDate = escapeHtml(preferredDate || "We'll arrange this with you");

  return `
  <div style="margin:0;padding:0;background:#050505;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;margin:0;padding:0;">
      <tr><td align="center" style="padding:22px 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;">

          <tr><td style="background:#050505;padding:28px 28px 24px;text-align:center;">
            <img src="${LOGO_URL}" width="180" alt="Ni Bin Guy" style="display:block;margin:0 auto 18px;max-width:180px;width:100%;height:auto;border:0;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#ffffff;font-size:34px;line-height:1.05;font-weight:900;text-transform:uppercase;">YOU ONLY WENT</div>
            <div style="font-family:Arial Black,Arial,sans-serif;color:${YELLOW};font-size:42px;line-height:1.05;font-weight:900;text-transform:uppercase;margin-top:4px;">AND DID IT.</div>
            <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:17px;line-height:1.5;margin-top:14px;">Nice one, ${firstName} — you nailed the 10 Second Challenge.</div>
          </td></tr>

          <tr><td style="background:${YELLOW};padding:20px 24px;text-align:center;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#050505;font-size:25px;font-weight:900;text-transform:uppercase;">🏆 YOU WON A FREE BIN CLEAN</div>
            <div style="font-family:Arial,sans-serif;color:#050505;font-size:14px;margin-top:5px;font-weight:700;">Stopped bang on 10.00 seconds.</div>
          </td></tr>

          <tr><td style="padding:26px 26px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND_GREEN};border-radius:14px;border:1px solid #14865b;">
              <tr><td style="padding:24px;text-align:center;">
                <div style="font-family:Arial Black,Arial,sans-serif;color:${YELLOW};font-size:15px;font-weight:900;text-transform:uppercase;">YOUR PRIZE</div>
                <div style="font-family:Arial Black,Arial,sans-serif;color:#ffffff;font-size:31px;font-weight:900;line-height:1.2;margin-top:8px;">1 × FREE ${safeBin.toUpperCase()} CLEAN</div>
                <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:14px;line-height:1.5;margin-top:10px;">Absolutely free. No catch. Just one very lucky bin.</div>
              </td></tr>
            </table>
          </td></tr>

          <tr><td style="padding:26px 26px 4px;text-align:center;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#111111;font-size:23px;font-weight:900;text-transform:uppercase;">WHAT HAPPENS NEXT?</div>
          </td></tr>

          <tr><td style="padding:12px 22px 4px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td width="33%" valign="top" align="center" style="padding:6px;"><div style="width:32px;height:32px;line-height:32px;background:${YELLOW};border-radius:50%;font-family:Arial,sans-serif;font-weight:900;">1</div><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:800;margin-top:8px;">WE'VE GOT YOUR DETAILS</div></td>
              <td width="33%" valign="top" align="center" style="padding:6px;"><div style="width:32px;height:32px;line-height:32px;background:${YELLOW};border-radius:50%;font-family:Arial,sans-serif;font-weight:900;">2</div><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:800;margin-top:8px;">WE'LL CONTACT YOU</div></td>
              <td width="33%" valign="top" align="center" style="padding:6px;"><div style="width:32px;height:32px;line-height:32px;background:${YELLOW};border-radius:50%;font-family:Arial,sans-serif;font-weight:900;">3</div><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:800;margin-top:8px;">YOUR BIN GETS THE VIP TREATMENT</div></td>
            </tr></table>
          </td></tr>

          <tr><td style="padding:18px 26px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;border-radius:14px;">
              <tr><td style="padding:20px;text-align:center;">
                <div style="font-family:Arial Black,Arial,sans-serif;color:#ffffff;font-size:21px;font-weight:900;text-transform:uppercase;">PREFERRED DATE</div>
                <div style="font-family:Arial,sans-serif;color:${YELLOW};font-size:18px;font-weight:700;margin-top:7px;">${safeDate}</div>
                <div style="font-family:Arial,sans-serif;color:#d8d8d8;font-size:13px;line-height:1.5;margin-top:7px;">We'll be in touch to get your free clean arranged.</div>
              </td></tr>
            </table>
          </td></tr>

          <tr><td style="padding:22px 26px 26px;text-align:center;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#111111;font-size:22px;font-weight:900;text-transform:uppercase;">TEN SECONDS. ONE FREE CLEAN. <span style="color:${BRAND_GREEN};">SORTED.</span></div>
            <div style="font-family:Arial,sans-serif;color:#555555;font-size:14px;line-height:1.6;margin-top:8px;">Thanks for having a go — and congratulations again.</div>
          </td></tr>

          <tr><td style="background:#050505;padding:20px;text-align:center;">
            <img src="${LOGO_URL}" width="105" alt="Ni Bin Guy" style="display:block;margin:0 auto 10px;max-width:105px;width:100%;height:auto;border:0;">
            <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:12px;line-height:1.8;">nibing.uy &nbsp; • &nbsp; 07555 178484 &nbsp; • &nbsp; info@nibing.uy</div>
            <div style="font-family:Arial,sans-serif;color:${YELLOW};font-size:13px;margin-top:7px;font-weight:700;">DIRTY BINS. SORTED.</div>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const host = requestHost(event);
  if (!ALLOWED_HOSTS.has(host)) {
    console.warn("Challenge winner rejected for host:", host || "missing");
    return json(403, { error: "Forbidden" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return json(400, { error: "Invalid request" });
  }

  if (payload.source !== "ten-second-challenge" || payload.website) {
    return json(403, { error: "Invalid submission" });
  }

  const name = clean(payload.name, 120);
  const email = clean(payload.email, 200);
  const phone = clean(payload.phone, 80);
  const address = clean(payload.address, 300);
  const binType = clean(payload?.bins?.[0]?.type || "Black Bin", 80);
  const preferredDate = clean(payload.preferred_date, 40);

  if (!name || !email || !phone || !address || !email.includes("@")) {
    return json(400, { error: "Missing required details" });
  }

  if (!(await enforceDailyLimit(event))) {
    return json(429, { error: "Winner details have already been submitted from this connection today" });
  }

  const subject = "Ten Second Challenge winner";
  const text = `A customer won the Ten Second Challenge.\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\nBin: ${binType}\nPreferred date: ${preferredDate || "Not supplied"}`;
  const html = `
    <h2>Ten Second Challenge winner</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
    <p><strong>Address:</strong> ${escapeHtml(address)}</p>
    <p><strong>Bin:</strong> ${escapeHtml(binType)}</p>
    <p><strong>Preferred date:</strong> ${escapeHtml(preferredDate || "Not supplied")}</p>
  `;

  try {
    const adminResult = await resend.emails.send({
      from: FROM,
      to: TO_ADMIN,
      replyTo: email,
      subject,
      text,
      html,
    });

    if (adminResult?.error) throw new Error(adminResult.error.message || "Admin email failed");

    const customerResult = await resend.emails.send({
      from: FROM,
      to: email,
      subject: "You won a free bin clean! 🏆",
      text: `Hi ${name},\n\nCongratulations — you stopped the timer at exactly 10.00 seconds and won a free ${binType} clean. We have your details and will contact you to arrange it.\n\nNi Bin Guy`,
      html: buildWinnerEmailHtml({ name, binType, preferredDate }),
    });

    if (customerResult?.error) {
      console.warn("Winner customer confirmation failed:", customerResult.error);
    }

    return json(200, { ok: true });
  } catch (error) {
    console.error("Challenge winner email failed:", error);
    return json(500, { error: "Unable to send winner email" });
  }
};
