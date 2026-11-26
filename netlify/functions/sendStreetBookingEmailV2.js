const BOOKING_TERMS = require("../../src/data/bookingTerms.json");
const crypto = require("crypto");
const { Resend } = require("resend");
const { getStore } = require("@netlify/blobs");
const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");
const { annualBookingBreakdown } = require("./lib/annualBookingBreakdown");
const { handler: sendSharedBooking } = require("./sendBookingEmail");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DEFAULT = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";
const TERMS_VERSION_DEFAULT = BOOKING_TERMS.version;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || "";
const RECAPTCHA_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || "0.5");
const SITE_ORIGIN = "https://nibing.uy";

const TERMS_BODY = BOOKING_TERMS.body;

function getStoreSafe(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  return siteID && token ? getStore({ name, siteID, token }) : getStore({ name });
}

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtGBP = (value) => `£${(Math.round((Number(value) || 0) * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;

function friendlyPlan(bin) {
  const raw = String(bin?.planId || "").toLowerCase();
  if (raw.includes("4w")) return "Every 4 weeks";
  if (raw.includes("one")) return "One-off clean";
  return bin?.planId || "Bin clean";
}

function randomShortCode(length = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

async function generateUniqueShortCode(store) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomShortCode(6);
    const existing = await store.get(code, { type: "json" });
    if (!existing) return code;
  }
  throw new Error("Unable to allocate unique short certificate code");
}

async function verifyRecaptcha(token, expectedAction) {
  if (!RECAPTCHA_SECRET || !token) return false;
  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token }),
  });
  const data = await response.json();
  if (!data?.success) return false;
  if (expectedAction && data.action && data.action !== expectedAction) return false;
  if (typeof data.score === "number" && data.score < RECAPTCHA_MIN_SCORE) return false;
  return true;
}

function buildCustomerHtml({ name, address, phone, bins, pricing, termsVersion, termsTimestamp, termsUrl }) {
  const firstName = escapeHtml(String(name || "there").trim().split(/\s+/)[0] || "there");
  const rows = bins.map((bin) => `<tr><td style="padding:9px 0;border-bottom:1px solid #333;color:#fff;font-weight:700">${escapeHtml(bin.count || 1)} × ${escapeHtml(bin.type)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #333;color:#ffd400;font-weight:700">${escapeHtml(friendlyPlan(bin))}</td></tr>`).join("");
  const recurring = bins.some((bin) => String(bin?.planId || "").includes("4w"));
  const acceptedAt = termsTimestamp ? new Date(termsTimestamp).toLocaleString("en-GB", { timeZone: "Europe/London" }) : "—";
  return `<div style="background:#050505;padding:20px;font-family:Arial,sans-serif"><div style="max-width:680px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:#050505;padding:28px;text-align:center"><img src="https://nibing.uy/logo.webp" width="190" alt="Ni Bin Guy"><h1 style="color:#ffd400;margin:18px 0 6px">BOOKING CONFIRMED</h1><p style="color:#fff">Nice one, ${firstName} — you’re all signed up.</p></div><div style="padding:26px"><p>Thanks for signing up with Ni Bin Guy. There is no quote to approve.</p><div style="background:#090909;border-radius:12px;padding:18px;margin:18px 0"><table width="100%">${rows}</table><p style="color:#fff"><strong>Address:</strong> ${escapeHtml(address)}<br><strong>Phone:</strong> ${escapeHtml(phone)}</p></div><div style="background:#0b6b44;color:#fff;padding:20px;border-radius:12px;text-align:center"><div>Your price</div><div style="font-size:42px;font-weight:900">${escapeHtml(fmtGBP(pricing?.total || 0))}</div></div><h2>What happens next?</h2><p>${recurring ? "Your 4-weekly service is now active. We’ll keep you updated with future service notifications." : "Your one-off booking has been recorded. Any service updates will be sent separately."}</p><p style="font-size:12px;color:#666">Terms accepted: v${escapeHtml(termsVersion)} at ${escapeHtml(acceptedAt)}. <a href="${escapeHtml(termsUrl)}">View your Terms & Conditions Acceptance Certificate</a>.</p></div></div></div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const payload = JSON.parse(event.body || "{}");
    // Never accept a browser-only PIN gate as authorization.
    // Store the actual PIN in Netlify's secret environment, not in the frontend.
    const suppliedPin = String(payload.staffPin || "");
    const configuredPin = String(process.env.STREET_SIGNUP_PIN || "");
    const validPin = /^\d{4,12}$/.test(configuredPin) &&
      suppliedPin.length === configuredPin.length &&
      crypto.timingSafeEqual(Buffer.from(suppliedPin), Buffer.from(configuredPin));
    if (!validPin) {
      return {statusCode:403,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
        body:JSON.stringify({error:"Invalid Street Signup PIN"})};
    }
    if (payload.action === "verify-pin") {
      return {statusCode:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
        body:JSON.stringify({verified:true})};
    }

    const {
      name = "", email = "", phone = "", address = "", bins = [], pricing = null,
      placeId = "", lat = null, lng = null, cleanCompletedToday = false,
      termsAccepted = false, termsTimestamp = new Date().toISOString(),
      recaptchaToken = null, recaptchaAction = "street_booking_submit",
    } = payload;

    if (!name || !phone || !address || !(Array.isArray(bins) && bins.some((bin) => bin?.type))) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required booking details" }) };
    }
    if (!termsAccepted) return { statusCode: 400, body: JSON.stringify({ error: "Terms must be accepted" }) };
    if (!(await verifyRecaptcha(recaptchaToken, recaptchaAction))) {
      return { statusCode: 403, body: JSON.stringify({ error: "Anti-bot check failed" }) };
    }

    // Share the production website booking pipeline: validation, terms PDF,
    // idempotency, Squeegee customer matching, automatic jobs and owner alerts.
    // The PIN was verified above by the server, not inferred from the source field.
    // Do not send the legacy confirmation first: that could falsely say that
    // Squeegee succeeded and would duplicate the shared booking emails.
    const delegated = { ...payload, source: "street-signup" };
    delete delegated.staffPin;
    const trustedEvent = {
      ...event,
      __streetSignupVerified: true,
      body: JSON.stringify(delegated),
    };
    return sendSharedBooking(trustedEvent);

  } catch (error) {
    console.error("sendStreetBookingEmailV2 failed:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Street signup failed" }) };
  }
};
