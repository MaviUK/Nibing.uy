const { Resend } = require("resend");
const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DEFAULT = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";
const TERMS_VERSION_DEFAULT = "July 2026";
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || "";
const RECAPTCHA_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || "0.5");

const TERMS_BODY = `
Ni Bin Guy – Terms of Service

• Regular 4-weekly plans are based on a 13-clean minimum term, which is approximately 12 months, unless agreed otherwise.
• One-off cleans have no minimum term and may be cancelled up to 24 hours before the scheduled clean day without charge.
• Bins must be left out or made accessible on the scheduled cleaning day and must remain available until 8pm.
• If your bin is not available when we attend, or access is blocked, the clean may still be charged.
• If we are unable to attend on the scheduled day, we will notify you and rearrange the clean as soon as reasonably possible.
• A 4-weekly plan may be cancelled any time up to 24 hours before the second scheduled clean. If cancelled before the second clean, the first clean will be charged at the standard one-off clean price, and any difference between the 4-weekly price and one-off price will become payable.
• After the second clean, the 4-weekly plan continues for the full 13-clean minimum term.
• If the customer cancels before the end of the 13-clean minimum term, they will remain liable for the outstanding balance for the remaining cleans within the 12-month minimum term.
• After the 13-clean minimum term has been completed, the plan continues on a rolling basis and may be cancelled by giving at least 30 days’ notice.
• One-off cleans containing dog faeces, cat litter, animal bedding, or other animal faeces/waste will incur a £5 surcharge per affected bin.
• We may refuse to clean bins containing excessive animal waste, hazardous waste, sharp items, medical waste, chemicals, paint, oil, rubble, hot ashes, or anything unsafe.
• Bins are cleaned inside and outside where safe using pressurised water and detergent. Some stains, ingrained smells, paint, tar, or long-term residue may take multiple visits or may not fully remove.
• Payment is due within 7 days unless agreed otherwise. Accepted methods are Direct Debit, Bank Transfer, and Card. No cash.
• Cancelling a Direct Debit does not cancel your service or contract. Cancellation must be requested directly with Ni Bin Guy.
• Overdue accounts may result in service being stopped and may be referred for recovery.
• Please keep your contact details, address, and payment details up to date, and make sure access is safe on cleaning day.
• We may place a small sticker or service tag on your bin. Discounts are discretionary and may be withdrawn or changed.
• You consent to us storing your details and contacting you about your booking, schedule, payment, and service.
• Text reminders are a courtesy only. You remain responsible for knowing your scheduled clean date.
`;

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
      <td style="padding:10px 0;border-bottom:1px solid #2d2d2d;color:#fff;font-family:Arial,sans-serif;font-weight:700;">${escapeHtml(bin.count || 1)} × ${escapeHtml(bin.type)}</td>
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
            <div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:34px;font-weight:900;text-transform:uppercase;">YOUR BIN IS</div>
            <div style="font-family:Arial Black,Arial,sans-serif;color:${yellow};font-size:42px;font-weight:900;text-transform:uppercase;">WHEELIE FRESH.</div>
            <div style="font-family:Arial,sans-serif;color:#fff;font-size:17px;line-height:1.5;margin-top:10px;">Nice one, ${firstName} — today’s clean is complete.</div>
          </td></tr>

          <tr><td style="background:${yellow};padding:18px 24px;text-align:center;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#050505;font-size:24px;font-weight:900;text-transform:uppercase;">✓ CLEAN COMPLETED TODAY</div>
            <div style="font-family:Arial,sans-serif;color:#050505;font-size:14px;margin-top:4px;font-weight:700;">This is your confirmation — there is no quote to approve.</div>
          </td></tr>

          <tr><td style="padding:26px;">
            <div style="font-family:Arial,sans-serif;color:#222;font-size:16px;line-height:1.65;">Thanks for signing up with Ni Bin Guy. We’ve recorded your clean as completed today and saved the service details below.</div>
          </td></tr>

          <tr><td style="padding:0 26px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;border-radius:14px;">
              <tr><td style="padding:20px 20px 8px;text-align:center;font-family:Arial Black,Arial,sans-serif;color:${yellow};font-size:20px;font-weight:900;text-transform:uppercase;">YOUR SERVICE</td></tr>
              <tr><td style="padding:0 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${binRows || `<tr><td style="color:#fff;padding:10px 0;">Your bin clean</td></tr>`}</table></td></tr>
              <tr><td style="padding:16px 20px 20px;color:#fff;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;"><strong>Address:</strong> ${escapeHtml(address)}${phone ? `<br><strong>Phone:</strong> ${escapeHtml(phone)}` : ""}</td></tr>
            </table>
          </td></tr>

          <tr><td style="padding:0 26px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${green};border-radius:14px;">
              <tr><td style="padding:22px;text-align:center;color:#fff;font-family:Arial,sans-serif;">
                <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:${yellow};">Recorded price</div>
                <div style="font-family:Arial Black,Arial,sans-serif;font-size:48px;font-weight:900;margin-top:4px;">${escapeHtml(total)}</div>
              </td></tr>
            </table>
          </td></tr>

          <tr><td style="padding:12px 26px 28px;">
            <div style="font-family:Arial Black,Arial,sans-serif;color:#111;font-size:22px;font-weight:900;text-transform:uppercase;">What happens next?</div>
            <div style="font-family:Arial,sans-serif;color:#333;font-size:15px;line-height:1.65;margin-top:10px;">${recurring ? "You’ve chosen a 4-weekly service. We’ll contact you with your next scheduled clean details — you do not need to approve a quote for today’s clean." : "You’ve chosen a one-off clean, so there is nothing else you need to do unless you’d like to book again."}</div>
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
      termsVersion = TERMS_VERSION_DEFAULT,
      termsAcceptanceText = `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION_DEFAULT}).`,
      termsTimestamp = new Date().toISOString(),
      recaptchaToken = null,
      recaptchaAction = "street_booking_submit",
    } = payload;

    if (!name || !email || !phone || !address || !(Array.isArray(bins) && bins.some((bin) => bin?.type))) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required booking details" }) };
    }
    if (!termsAccepted) {
      return { statusCode: 400, body: JSON.stringify({ error: "Terms must be accepted" }) };
    }

    const recaptcha = await verifyRecaptcha({ token: recaptchaToken, expectedAction: recaptchaAction });
    if (!recaptcha.ok) {
      console.warn("reCAPTCHA blocked street booking:", recaptcha.reason, recaptcha.data || "");
      return { statusCode: 403, body: JSON.stringify({ error: "Anti-bot check failed" }) };
    }

    const filteredBins = bins.filter((bin) => bin?.type);
    const binsText = filteredBins.map((bin) => `${bin.count || 1} x ${bin.type} (${friendlyPlan(bin)})`).join("\n");
    const pricingText = `Total: ${fmtGBP(pricing?.total || 0)}`;

    const termsPdfAttachment = await buildTermsAcceptancePdfAttachment({
      name,
      email,
      phone,
      address,
      binsText,
      pricingText,
      termsAccepted,
      termsVersion,
      termsAcceptanceText,
      termsTimestamp,
      termsBody: TERMS_BODY,
      source,
    }).catch((error) => {
      console.warn("Street signup terms PDF skipped:", error.message);
      return null;
    });

    const attachments = termsPdfAttachment ? [termsPdfAttachment] : undefined;
    const geoText = lat != null && lng != null ? `${lat}, ${lng}` : "—";

    const adminPromise = resend.emails.send({
      from: FROM_DEFAULT,
      to: TO_ADMIN,
      subject: "🧼 Street signup — clean completed today",
      text: `Street signup completed\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\nBins:\n${binsText}\n\n${pricingText}\nClean completed today: ${cleanCompletedToday ? "yes" : "no"}\nPlace ID: ${placeId || "—"}\nGeo: ${geoText}\n\nTerms accepted: yes\nVersion: ${termsVersion}\nConfirmed: ${termsTimestamp}\n\nNo quote required.`,
      html: `<h2>Street signup — clean completed today</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Phone:</strong> ${escapeHtml(phone)}</p><p><strong>Address:</strong> ${escapeHtml(address)}</p><p><strong>Bins:</strong><br>${filteredBins.map((bin) => `${escapeHtml(bin.count || 1)} x ${escapeHtml(bin.type)} — ${escapeHtml(friendlyPlan(bin))}`).join("<br>")}</p><p><strong>Total:</strong> ${escapeHtml(fmtGBP(pricing?.total || 0))}</p><p><strong>Clean completed today:</strong> Yes</p><p><strong>No quote required.</strong></p><hr><p>Terms: v${escapeHtml(termsVersion)} accepted ${escapeHtml(termsTimestamp)}</p>`,
      replyTo: email,
      attachments,
    });

    const customerPromise = resend.emails.send({
      from: FROM_DEFAULT,
      to: email,
      subject: "🧼 Your Ni Bin Guy clean is complete",
      text: `Thanks ${name},\n\nYour Ni Bin Guy clean has been completed today. This is your confirmation and there is no quote to approve.\n\nAddress: ${address}\nPhone: ${phone}\n\nBins:\n${binsText}\n\n${pricingText}\n\n${filteredBins.some((bin) => String(bin.planId || "").includes("4w")) ? "You chose a 4-weekly service. We’ll contact you with your next scheduled clean details." : "You chose a one-off clean, so there is nothing else you need to do."}\n\nTerms accepted: v${termsVersion} at ${termsTimestamp}.${termsPdfAttachment ? "\nYour Terms & Conditions Acceptance Certificate is attached." : ""}`,
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
      body: JSON.stringify({ success: true, customerConfirmationSent: !customerResult?.error }),
    };
  } catch (error) {
    console.error("sendStreetBookingEmail failed:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Street signup failed" }) };
  }
};
