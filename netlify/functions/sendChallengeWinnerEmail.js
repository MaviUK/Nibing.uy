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
      subject: "You won a free bin clean!",
      text: `Hi ${name},\n\nCongratulations — you stopped the timer at exactly 10.00 seconds. We have received your details and will contact you to arrange your free ${binType} clean.\n\nNi Bin Guy`,
      html: `<p>Hi ${escapeHtml(name)},</p><p>Congratulations — you stopped the timer at exactly <strong>10.00 seconds</strong>.</p><p>We have received your details and will contact you to arrange your free ${escapeHtml(binType)} clean.</p><p>Ni Bin Guy</p>`,
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
