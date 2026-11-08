const BOOKING_TERMS = require("../../src/data/bookingTerms.json");
const { Resend } = require("resend");
const { signBooking } = require("./lib/arcadeBookingProof");
const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");
const { annualBookingBreakdown } = require("./lib/annualBookingBreakdown");
const { validateCommercialBinSizes } = require("./lib/squeegeeBookingPricing");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DEFAULT = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";
const TERMS_VERSION_DEFAULT = BOOKING_TERMS.version;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || "";
const RECAPTCHA_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || "0.5");

const TERMS_BODY = BOOKING_TERMS.body;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtGBP = (value) => {
  const amount = Math.round((Number(value) || 0) * 100) / 100;
  return `£${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
};

function friendlyPlan(bin) {
  const raw = String(bin?.planId || "").toLowerCase();
  if (raw.includes("4w")) return "Every 4 weeks";
  if (raw.includes("one")) return "One-off clean";
  return bin?.planId || "Bin clean";
}

async function verifyRecaptcha({ token, expectedAction }) {
  if (!RECAPTCHA_SECRET) return { ok: false, reason: "missing_secret" };
  if (!token) return { ok: false, reason: "missing_token" };

  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token }),
  });
  const data = await response.json();
  if (!data?.success) return { ok: false, reason: "not_success", data };
  if (expectedAction && data.action && data.action !== expectedAction) return { ok: false, reason: "action_mismatch", data };
  if (typeof data.score === "number" && data.score < RECAPTCHA_MIN_SCORE) return { ok: false, reason: "low_score", data };
  return { ok: true, data };
}

function buildCustomerHtml({ name, address, phone, bins, pricing, termsVersion, termsTimestamp, termsPdfAttached }) {
  const firstName = escapeHtml(String(name || "there").trim().split(/\s+/)[0] || "there");
  const total = fmtGBP(pricing?.total || 0);
  const logoUrl = "https://nibing.uy/logo.webp";
  const yellow = "#ffd400";
  const green = "#0b6b44";

  const binRows = (Array.isArray(bins) ? bins : []).filter((bin) => bin?.type).map((bin) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #2d2d2d;color:#fff;font-family:Arial,sans-serif;font-weight:700;">${escapeHtml(bin.count || 1)} × ${escapeHtml(bin.type)}${bin.sizeLitres === 660 || bin.sizeLitres === 1100 ? " (" + bin.sizeLitres + "L)" : ""}</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #2d2d2d;color:${yellow};font-family:Arial,sans-serif;font-weight:700;">${escapeHtml(friendlyPlan(bin))}</td>
    </tr>`).join("");

  const recurring = (Array.isArray(bins) ? bins : []).some((bin) => String(bin?.planId || "").includes("4w"));
  const confirmedAt = termsTimestamp
    ? new Date(termsTimestamp).toLocaleString("en-GB", { timeZone: "Europe/London" })
    : "—";

  return `
  <div style="margin:0;padding:0;background:#050505;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;">
      <tr><td align="center" style="padding:22px 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;">
          <tr><td style="background:#050505;padding:28px;text-align:center;">
            <img src="${logoUrl}" width="190" alt="Ni Bin Guy" style="display:block;margin:0 auto 18px;max-width:190px;width:100%;height:auto;border:0;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:34px;font-weight:900;text-transform:uppercase;">WELCOME TO</div>
            <div style="font-family:Arial Black,Arial,sans-serif;color:${yellow};font-size:42px;font-weight:900;text-transform:uppercase;">NI BIN GUY.</div>
            <div style="font-family:Arial,sans-serif;color:#fff;font-size:17px;line-height:1.5;margin-top:10px;">Nice one, ${firstName} — your booking is confirmed.</div>
          </td></tr>

          <tr><td style="background:${yellow};padding:18px 24px;text-align:center;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#050505;font-size:24px;font-weight:900;text-transform:uppercase;">✓ BOOKING CONFIRMED</div>
            <div style="font-family:Arial,sans-serif;color:#050505;font-size:14px;margin-top:4px;font-weight:700;">You’re all signed up. There is no quote to approve.</div>
          </td></tr>

          <tr><td style="padding:26px;">
            <div style="font-family:Arial,sans-serif;color:#222;font-size:16px;line-height:1.65;">Thanks for signing up with Ni Bin Guy. Your booking has been set up and your service details are below.</div>
          </td></tr>

          <tr><td style="padding:0 26px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;border-radius:14px;">
              <tr><td style="padding:20px 20px 8px;text-align:center;font-family:Arial Black,Arial,sans-serif;color:${yellow};font-size:20px;font-weight:900;text-transform:uppercase;">YOUR BOOKING</td></tr>
              <tr><td style="padding:0 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${binRows || `<tr><td style="color:#fff;padding:10px 0;">Your bin clean</td></tr>`}</table></td></tr>
              <tr><td style="padding:16px 20px 20px;color:#fff;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;"><strong>Address:</strong> ${escapeHtml(address)}${phone ? `<br><strong>Phone:</strong> ${escapeHtml(phone)}` : ""}</td></tr>
            </table>
          </td></tr>

          <tr><td style="padding:0 26px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${green};border-radius:14px;">
              <tr><td style="padding:22px;text-align:center;color:#fff;font-family:Arial,sans-serif;">
                <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:${yellow};">Your price</div>
                <div style="font-family:Arial Black,Arial,sans-serif;font-size:48px;font-weight:900;margin-top:4px;">${escapeHtml(total)}</div>
              </td></tr>
            </table>
          </td></tr>

          <tr><td style="padding:12px 26px 28px;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#111;font-size:22px;font-weight:900;text-transform:uppercase;">What happens next?</div>
            <div style="font-family:Arial,sans-serif;color:#333;font-size:15px;line-height:1.65;margin-top:10px;">${recurring ? "Your 4-weekly service is now active. We’ll keep you updated with your future cleaning schedule and service notifications." : "Your one-off booking has been recorded. Any service updates will be sent separately."}</div>
          </td></tr>

          <tr><td style="background:#f5f5f5;padding:18px 26px;font-family:Arial,sans-serif;color:#555;font-size:12px;line-height:1.5;">
            Terms accepted: v${escapeHtml(termsVersion || TERMS_VERSION_DEFAULT)} at ${escapeHtml(confirmedAt)}.${termsPdfAttached ? " Your Terms & Conditions Acceptance Certificate is attached." : ""}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const {
      name = "",
      email = "",
      phone = "",
      address = "",
      bins = [],
      pricing = null,
      placeId = "",
      lat = null,
      lng = null,
      source = "street-signup",
      cleanCompletedToday = true,
      termsAccepted = false,
      termsTimestamp = new Date().toISOString(),
      recaptchaToken = null,
      recaptchaAction = "street_booking_submit",
    } = payload;

    const termsVersion = TERMS_VERSION_DEFAULT;
    const termsAcceptanceText = `I confirm I've read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION_DEFAULT})`;

    if (!name || !email || !phone || !address || !(Array.isArray(bins) && bins.some((bin) => bin?.type))) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required booking details" }) };
    }
    if (!termsAccepted) {
      return { statusCode: 400, body: JSON.stringify({ error: "Terms must be accepted" }) };
    }

    const binSizeCheck = validateCommercialBinSizes(bins);
    if (!binSizeCheck.ok) {
      return {
        statusCode: 422,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({
          error: "Choose 660L or 1100L for each large commercial bin.",
          reason: binSizeCheck.reason,
        }),
      };
    }

    const recaptcha = await verifyRecaptcha({ token: recaptchaToken, expectedAction: recaptchaAction });
    if (!recaptcha.ok) {
      console.warn("reCAPTCHA blocked street booking:", recaptcha.reason, recaptcha.data || "");
      return { statusCode: 403, body: JSON.stringify({ error: "Anti-bot check failed" }) };
    }

    const filteredBins = bins.filter((bin) => bin?.type);
    const binsText = filteredBins.map((bin) => {
      const size=bin.sizeLitres ? " ("+bin.sizeLitres+"L)" : "";
      return `${bin.count || 1} x ${bin.type}${size} (plan: ${bin.planId || ""})`;
    }).join("\n");
    const pricingLines = Array.isArray(pricing?.lines) ? pricing.lines : [];
    const pricingText = pricingLines.length
      ? `Pricing:\n${pricingLines.map((line) => `${line.count || 1}x ${String(line.type || "").replace(" Bin", "")} - ${line.planLabel || friendlyPlan({ planId: line.planId })} @ GBP ${Number(line.unitPrice || 0)} = GBP ${Number(line.lineTotal || 0)}`).join("\n")}\n\nSubtotal: GBP ${Number(pricing?.subtotal || 0)}\nTotal: GBP ${Number(pricing?.total || 0)}\n\nDiscount Code: None`
      : `Pricing:\n(No pricing breakdown provided)\n\nSubtotal: GBP ${Number(pricing?.subtotal || 0)}\nTotal: GBP ${Number(pricing?.total || 0)}\n\nDiscount Code: None`;

    const termsPdfAttachment = await buildTermsAcceptancePdfAttachment({
      name,
      email,
      phone,
      address,
      binsText,
      pricingText,
      annualBreakdownText: annualBookingBreakdown(pricing),
      termsAccepted,
      termsVersion,
      termsAcceptanceText,
      termsTimestamp,
      termsBody: TERMS_BODY,
      source: "street-signup",
    }).catch((error) => {
      console.warn("Street signup terms PDF skipped:", error.message);
      return null;
    });

    const attachments = termsPdfAttachment ? [termsPdfAttachment] : undefined;
    const geoText = lat != null && lng != null ? `${lat}, ${lng}` : "—";

    const adminPromise = resend.emails.send({
      from: FROM_DEFAULT,
      to: TO_ADMIN,
      subject: "🧼 Street signup — booking confirmed",
      text: `Street signup booking confirmed\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\nBins:\n${binsText}\n\n${pricingText}\nClean completed on signup visit: ${cleanCompletedToday ? "yes" : "no"}\nPlace ID: ${placeId || "—"}\nGeo: ${geoText}\n\nTerms accepted: yes\nVersion: ${termsVersion}\nConfirmed: ${termsTimestamp}\n\nNo quote required.`,
      html: `<h2>Street signup — booking confirmed</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Phone:</strong> ${escapeHtml(phone)}</p><p><strong>Address:</strong> ${escapeHtml(address)}</p><p><strong>Bins:</strong><br>${filteredBins.map((bin) => `${escapeHtml(bin.count || 1)} x ${escapeHtml(bin.type)}${bin.sizeLitres === 660 || bin.sizeLitres === 1100 ? " (" + bin.sizeLitres + "L)" : ""} — ${escapeHtml(friendlyPlan(bin))}`).join("<br>")}</p><p><strong>Total:</strong> ${escapeHtml(fmtGBP(pricing?.total || 0))}</p><p><strong>Clean completed on signup visit:</strong> ${cleanCompletedToday ? "Yes" : "No"}</p><p><strong>No quote required.</strong></p><hr><p>Terms: v${escapeHtml(termsVersion)} accepted ${escapeHtml(termsTimestamp)}</p>`,
      replyTo: email,
      attachments,
    });

    const customerPromise = resend.emails.send({
      from: FROM_DEFAULT,
      to: email,
      subject: "🗑️ Booking confirmed — welcome to Ni Bin Guy",
      text: `Thanks ${name},\n\nYour Ni Bin Guy booking is confirmed and you’re all signed up. There is no quote to approve.\n\nAddress: ${address}\nPhone: ${phone}\n\nBins:\n${binsText}\n\nTotal: ${fmtGBP(pricing?.total || 0)}\n\n${filteredBins.some((bin) => String(bin.planId || "").includes("4w")) ? "Your 4-weekly service is now active. We’ll keep you updated with your future cleaning schedule and service notifications." : "Your one-off booking has been recorded. Any service updates will be sent separately."}\n\nTerms accepted: v${termsVersion} at ${termsTimestamp}.${termsPdfAttachment ? "\nYour Terms & Conditions Acceptance Certificate is attached." : ""}`,
      html: buildCustomerHtml({
        name,
        address,
        phone,
        bins: filteredBins,
        pricing,
        termsVersion,
        termsTimestamp,
        termsPdfAttached: Boolean(termsPdfAttachment),
      }),
      replyTo: TO_ADMIN,
      attachments,
    });

    const [adminResult, customerResult] = await Promise.all([adminPromise, customerPromise]);
    if (adminResult?.error) {
      console.error("Street signup admin email error:", adminResult.error);
      return { statusCode: 502, body: JSON.stringify({ error: "Failed to send admin email" }) };
    }
    if (customerResult?.error) console.error("Street signup customer email error:", customerResult.error);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, customerConfirmationSent: !customerResult?.error, arcadeBookingProof: signBooking(payload) }),
    };
  } catch (error) {
    console.error("sendStreetBookingEmail failed:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Street signup failed" }) };
  }
};