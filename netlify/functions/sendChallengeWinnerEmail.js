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
const SITE_ORIGIN = "https://nibing.uy";
const LOGO_URL = `${SITE_ORIGIN}/logo.webp`;
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

function extractPostcode(address) {
  const match = String(address || "").toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  if (!match) return "";
  const compact = match[1].replace(/\s+/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

function formatCleanDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

async function getAutomaticSchedule(address, binType) {
  const postcode = extractPostcode(address);
  if (!postcode) return { matched: false, reason: "postcode_missing" };

  try {
    const response = await fetch(`${SITE_ORIGIN}/api/booking-schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address,
        postcode,
        bins: [{ type: binType }],
      }),
    });

    const data = await response.json().catch(() => ({}));
    const result = Array.isArray(data?.results) ? data.results[0] : null;
    const assignedCleanDate = result?.automatic && result?.assignedCleanDate
      ? String(result.assignedCleanDate)
      : null;

    if (!response.ok || !assignedCleanDate) {
      return {
        matched: false,
        reason: data?.reason || result?.reason || "no_automatic_match",
        raw: data,
      };
    }

    return {
      matched: true,
      assignedCleanDate,
      formattedCleanDate: formatCleanDate(assignedCleanDate),
      round: result?.round || null,
      councilDates: result?.councilDates || [],
    };
  } catch (error) {
    console.warn("Challenge winner schedule lookup failed:", error.message);
    return { matched: false, reason: "schedule_lookup_failed" };
  }
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

function buildWinnerEmailHtml({ name, binType, schedule }) {
  const firstName = escapeHtml(String(name || "there").trim().split(/\s+/)[0] || "there");
  const safeBin = escapeHtml(binType);
  const dateHeading = schedule.matched ? "YOUR CLEAN DATE" : "YOUR CLEAN DATE";
  const dateValue = schedule.matched
    ? escapeHtml(schedule.formattedCleanDate)
    : "We'll confirm this with you shortly";
  const dateNote = schedule.matched
    ? "Your free clean has been matched to the next suitable round in your area."
    : "We couldn't safely auto-match the council schedule, so we'll confirm the date manually.";

  return `
  <div style="margin:0;padding:0;background:#050505;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;margin:0;padding:0;">
      <tr><td align="center" style="padding:22px 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;">
          <tr><td style="background:#050505;padding:28px;text-align:center;">
            <img src="${LOGO_URL}" width="180" alt="Ni Bin Guy" style="display:block;margin:0 auto 18px;max-width:180px;width:100%;height:auto;border:0;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#ffffff;font-size:32px;font-weight:900;text-transform:uppercase;">YOU ONLY WENT</div>
            <div style="font-family:Arial Black,Arial,sans-serif;color:${YELLOW};font-size:40px;font-weight:900;text-transform:uppercase;">AND DID IT.</div>
            <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:17px;line-height:1.5;margin-top:12px;">Nice one, ${firstName} — you nailed the 10 Second Challenge.</div>
          </td></tr>
          <tr><td style="background:${YELLOW};padding:20px 24px;text-align:center;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#050505;font-size:25px;font-weight:900;text-transform:uppercase;">🏆 YOU WON A FREE BIN CLEAN</div>
          </td></tr>
          <tr><td style="padding:26px 26px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND_GREEN};border-radius:14px;">
              <tr><td style="padding:24px;text-align:center;">
                <div style="font-family:Arial Black,Arial,sans-serif;color:${YELLOW};font-size:15px;font-weight:900;text-transform:uppercase;">YOUR PRIZE</div>
                <div style="font-family:Arial Black,Arial,sans-serif;color:#ffffff;font-size:30px;font-weight:900;margin-top:8px;">1 × FREE ${safeBin.toUpperCase()} CLEAN</div>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:20px 26px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;border-radius:14px;">
              <tr><td style="padding:22px;text-align:center;">
                <div style="font-family:Arial Black,Arial,sans-serif;color:#ffffff;font-size:21px;font-weight:900;text-transform:uppercase;">${dateHeading}</div>
                <div style="font-family:Arial,sans-serif;color:${YELLOW};font-size:20px;font-weight:800;margin-top:8px;">${dateValue}</div>
                <div style="font-family:Arial,sans-serif;color:#d8d8d8;font-size:13px;line-height:1.5;margin-top:8px;">${escapeHtml(dateNote)}</div>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:24px 26px;text-align:center;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#111;font-size:21px;font-weight:900;">TEN SECONDS. ONE FREE CLEAN. <span style="color:${BRAND_GREEN};">SORTED.</span></div>
          </td></tr>
          <tr><td style="background:#050505;padding:20px;text-align:center;">
            <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:12px;">nibing.uy &nbsp; • &nbsp; 07555 178484 &nbsp; • &nbsp; info@nibing.uy</div>
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

  if (!name || !email || !phone || !address || !email.includes("@")) {
    return json(400, { error: "Missing required details" });
  }

  if (!(await enforceDailyLimit(event))) {
    return json(429, { error: "Winner details have already been submitted from this connection today" });
  }

  const schedule = await getAutomaticSchedule(address, binType);
  const cleanDateText = schedule.matched ? schedule.formattedCleanDate : "Manual confirmation required";

  const subject = schedule.matched
    ? `Ten Second Challenge winner — ${cleanDateText}`
    : "Ten Second Challenge winner — date needs checked";

  const text = `A customer won the Ten Second Challenge.\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\nBin: ${binType}\nClean date: ${cleanDateText}\nAutomatic schedule: ${schedule.matched ? "yes" : "no"}\n${schedule.reason ? `Reason: ${schedule.reason}\n` : ""}`;

  const html = `
    <h2>Ten Second Challenge winner</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
    <p><strong>Address:</strong> ${escapeHtml(address)}</p>
    <p><strong>Bin:</strong> ${escapeHtml(binType)}</p>
    <p><strong>Clean date:</strong> ${escapeHtml(cleanDateText)}</p>
    <p><strong>Automatic schedule:</strong> ${schedule.matched ? "Yes" : "No — please check manually"}</p>
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

    const customerText = schedule.matched
      ? `Hi ${name},\n\nCongratulations — you stopped the timer at exactly 10.00 seconds and won a free ${binType} clean. Your free clean has been booked for ${cleanDateText}.\n\nNi Bin Guy`
      : `Hi ${name},\n\nCongratulations — you stopped the timer at exactly 10.00 seconds and won a free ${binType} clean. We have your details and will contact you shortly to confirm the clean date.\n\nNi Bin Guy`;

    const customerResult = await resend.emails.send({
      from: FROM,
      to: email,
      subject: schedule.matched
        ? `Your free bin clean is booked for ${cleanDateText} 🏆`
        : "You won a free bin clean! 🏆",
      text: customerText,
      html: buildWinnerEmailHtml({ name, binType, schedule }),
    });

    if (customerResult?.error) {
      console.warn("Winner customer confirmation failed:", customerResult.error);
    }

    return json(200, {
      ok: true,
      scheduleMatched: schedule.matched,
      assignedCleanDate: schedule.assignedCleanDate || null,
      formattedCleanDate: schedule.formattedCleanDate || null,
      customerConfirmationSent: !customerResult?.error,
    });
  } catch (error) {
    console.error("Challenge winner email failed:", error);
    return json(500, { error: "Unable to send winner email" });
  }
};
