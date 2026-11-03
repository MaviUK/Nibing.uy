const BOOKING_TERMS = require("../../src/data/bookingTerms.json");
const crypto = require("crypto");
const { Resend } = require("resend");
const { getStore } = require("@netlify/blobs");
const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");

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
    const {
      name = "", email = "", phone = "", address = "", bins = [], pricing = null,
      placeId = "", lat = null, lng = null, cleanCompletedToday = true,
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

    const filteredBins = bins.filter((bin) => bin?.type);
    const binsText = filteredBins.map((bin) => `${bin.count || 1} x ${bin.type} (plan: ${bin.planId || ""})`).join("\n");
    const pricingLines = Array.isArray(pricing?.lines) ? pricing.lines : [];
    const pricingText = pricingLines.length
      ? `Pricing:\n${pricingLines.map((line) => `${line.count || 1}x ${String(line.type || "").replace(" Bin", "")} - ${line.planLabel || friendlyPlan({ planId: line.planId })} @ GBP ${Number(line.unitPrice || 0)} = GBP ${Number(line.lineTotal || 0)}`).join("\n")}\n\nSubtotal: GBP ${Number(pricing?.subtotal || 0)}\nTotal: GBP ${Number(pricing?.total || 0)}\n\nDiscount Code: None`
      : `Pricing:\nSubtotal: GBP ${Number(pricing?.subtotal || 0)}\nTotal: GBP ${Number(pricing?.total || 0)}\n\nDiscount Code: None`;

    const termsVersion = TERMS_VERSION_DEFAULT;
    const termsAcceptanceText = `I confirm I've read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION_DEFAULT})`;
    const termsPdfAttachment = await buildTermsAcceptancePdfAttachment({
      name, email, phone, address, binsText, pricingText, termsAccepted: true,
      termsVersion, termsAcceptanceText, termsTimestamp, termsBody: TERMS_BODY, source: "street-signup",
    });

    const store = getStoreSafe("street-terms-documents");
    const documentId = await generateUniqueShortCode(store);
    const termsUrl = `${SITE_ORIGIN}/${documentId}`;
    await store.setJSON(documentId, {
      filename: termsPdfAttachment.filename,
      contentType: "application/pdf",
      base64: termsPdfAttachment.content,
      createdAt: new Date().toISOString(),
      name,
      phone,
      email: email || null,
    });

    const geoText = lat != null && lng != null ? `${lat}, ${lng}` : "—";
    const emailDisplay = email || "No email address provided";
    const adminText = `Street signup booking confirmed\n\nName: ${name}\nEmail: ${emailDisplay}\nPhone: ${phone}\nAddress: ${address}\nBins:\n${binsText}\n\nTotal: ${fmtGBP(pricing?.total || 0)}\nClean completed on signup visit: ${cleanCompletedToday ? "yes" : "no"}\nPlace ID: ${placeId || "—"}\nGeo: ${geoText}\n\nTerms accepted: yes\nVersion: ${termsVersion}\nConfirmed: ${termsTimestamp}\nTerms certificate URL: ${termsUrl}\n\nNo quote required.`;
    const adminHtml = `<h2>Street signup — booking confirmed</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(emailDisplay)}</p><p><strong>Phone:</strong> ${escapeHtml(phone)}</p><p><strong>Address:</strong> ${escapeHtml(address)}</p><p><strong>Bins:</strong><br>${filteredBins.map((bin) => `${escapeHtml(bin.count || 1)} x ${escapeHtml(bin.type)} — ${escapeHtml(friendlyPlan(bin))}`).join("<br>")}</p><p><strong>Total:</strong> ${escapeHtml(fmtGBP(pricing?.total || 0))}</p><p><strong>Clean completed on signup visit:</strong> ${cleanCompletedToday ? "Yes" : "No"}</p><p><strong>Terms certificate:</strong> <a href="${escapeHtml(termsUrl)}">${escapeHtml(termsUrl)}</a></p><p><strong>No quote required.</strong></p>`;

    const adminResult = await resend.emails.send({
      from: FROM_DEFAULT,
      to: TO_ADMIN,
      subject: "🧼 Street signup — booking confirmed",
      text: adminText,
      html: adminHtml,
      replyTo: email || TO_ADMIN,
      attachments: [termsPdfAttachment],
    });
    if (adminResult?.error) throw new Error(`Admin email failed: ${adminResult.error.message || "unknown error"}`);

    let customerConfirmationSent = false;
    if (email) {
      const customerResult = await resend.emails.send({
        from: FROM_DEFAULT,
        to: email,
        subject: "🗑️ Booking confirmed — welcome to Ni Bin Guy",
        text: `Thanks ${name},\n\nYour Ni Bin Guy booking is confirmed and you’re all signed up. There is no quote to approve.\n\nAddress: ${address}\nPhone: ${phone}\n\nBins:\n${binsText}\n\nTotal: ${fmtGBP(pricing?.total || 0)}\n\nYour Terms & Conditions Acceptance Certificate: ${termsUrl}`,
        html: buildCustomerHtml({ name, address, phone, bins: filteredBins, pricing, termsVersion, termsTimestamp, termsUrl }),
        replyTo: TO_ADMIN,
        attachments: [termsPdfAttachment],
      });
      customerConfirmationSent = !customerResult?.error;
      if (customerResult?.error) console.error("Street signup customer email error:", customerResult.error);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, customerConfirmationSent, termsUrl }),
    };
  } catch (error) {
    console.error("sendStreetBookingEmailV2 failed:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Street signup failed" }) };
  }
};
