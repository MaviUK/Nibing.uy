// netlify/functions/sendBookingEmail.js
const { Resend } = require("resend");
const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");
const { buildBookingEmailHtml } = require("./lib/bookingEmailTemplate");

// Optional audit logging. If Netlify Blobs is unavailable, logging is skipped.
let getStoreSafe = null;
try {
  const { getStore } = require("@netlify/blobs");
  getStoreSafe = function (name) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
    return siteID && token ? getStore({ name, siteID, token }) : getStore({ name });
  };
} catch (_) {
  // Blobs are optional.
}

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

function tosHtmlBlock(version, timestampIso) {
  const when = timestampIso
    ? new Date(timestampIso).toLocaleString("en-GB", { timeZone: "Europe/London" })
    : "—";

  return `
    <h3 style="margin:16px 0 6px">Terms of Service confirmation</h3>
    <p style="margin:0 0 10px">
      Version: <strong>${escapeHtml(version || TERMS_VERSION_DEFAULT)}</strong><br>
      Confirmed at: <strong>${escapeHtml(when)}</strong>
    </p>
    <pre style="white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px;border:1px solid #eee;margin:0">${escapeHtml(TERMS_BODY)}</pre>
  `;
}

function buildPricingBlocks(pricing, discountCode) {
  const code = String(discountCode || "").trim();
  const lines = Array.isArray(pricing?.lines) ? pricing.lines : [];

  if (!lines.length) {
    return {
      applied: false,
      text: `Pricing:\n(No pricing breakdown provided)\n\nDiscount Code: ${code || "None"}`,
      html: `
        <h3 style="margin:16px 0 6px">Pricing</h3>
        <p style="margin:0 0 8px;color:#6b7280">(No pricing breakdown provided)</p>
        <p style="margin:0"><strong>Discount Code:</strong> ${escapeHtml(code || "None")}</p>
      `,
    };
  }

  const applied = Boolean(code && lines.some((line) => Boolean(line.discounted)));
  const textLines = lines.map((line) => {
    const type = String(line.type || "").replace(" Bin", "");
    const badge = line.discounted ? " (discounted)" : "";
    return `${line.count || 1}x ${type} — ${line.planLabel || ""} @ ${fmtGBP(line.unitPrice)}${badge} = ${fmtGBP(line.lineTotal)}`;
  });

  const subtotal = fmtGBP(pricing.subtotal);
  const total = fmtGBP(pricing.total);
  const codeStatus = code ? (applied ? " (applied)" : " (not applied)") : "";

  const htmlLines = lines
    .map((line) => {
      const type = escapeHtml(String(line.type || "").replace(" Bin", ""));
      const badge = line.discounted
        ? ` <span style="color:#059669;font-weight:700">(discounted)</span>`
        : "";
      return `<div style="margin:0 0 6px">${escapeHtml(line.count || 1)}x <strong>${type}</strong> — ${escapeHtml(line.planLabel || "")} @ ${escapeHtml(fmtGBP(line.unitPrice))}${badge} = <strong>${escapeHtml(fmtGBP(line.lineTotal))}</strong></div>`;
    })
    .join("");

  return {
    applied,
    text: `Pricing:\n${textLines.join("\n")}\n\nSubtotal: ${subtotal}\nTotal: ${total}\n\nDiscount Code: ${code || "None"}${codeStatus}`,
    html: `
      <h3 style="margin:16px 0 6px">Pricing</h3>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px">
        ${htmlLines}
        <div style="margin-top:10px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between">
          <div style="color:#374151">Subtotal</div><div style="font-weight:700">${escapeHtml(subtotal)}</div>
        </div>
        <div style="margin-top:6px;display:flex;justify-content:space-between">
          <div style="color:#111827;font-weight:700">Total</div><div style="font-weight:800">${escapeHtml(total)}</div>
        </div>
      </div>
      <p style="margin:10px 0 0"><strong>Discount Code:</strong> ${escapeHtml(code || "None")}${code ? (applied ? " <span style='color:#059669;font-weight:700'>(applied)</span>" : " <span style='color:#dc2626;font-weight:700'>(not applied)</span>") : ""}</p>
    `,
  };
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
  if (expectedAction && data.action && data.action !== expectedAction) {
    return { ok: false, reason: "action_mismatch", data };
  }
  if (typeof data.score === "number" && data.score < RECAPTCHA_MIN_SCORE) {
    return { ok: false, reason: "low_score", data };
  }

  return { ok: true, data };
}

function buildAuditPromise(details) {
  if (!getStoreSafe) return Promise.resolve();

  return (async () => {
    try {
      const store = getStoreSafe("tos-confirmations");
      const identifier = details.email || details.phone || "unknown";
      const key = `${new Date().toISOString()}__${identifier.replace(/[^a-z0-9@.+_-]/gi, "_")}.json`;
      await store.setJSON(key, details);
    } catch (error) {
      console.warn("Blobs log skipped:", error.message);
    }
  })();
}

exports.handler = async (event) => {
  const startedAt = Date.now();

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const recaptchaToken = payload.recaptchaToken || null;
    const recaptchaAction = payload.recaptchaAction || "booking_submit";

    const {
      name = "",
      address = "",
      phone = "",
      email = "",
      bins = [],
      placeId = "",
      lat = null,
      lng = null,
      source = "website",
      discountCode = null,
      pricing = null,
      termsAccepted = false,
      termsVersion = TERMS_VERSION_DEFAULT,
      termsAcceptanceText = `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION_DEFAULT}).`,
      termsTimestamp = new Date().toISOString(),
    } = payload;

    const filteredBins = (Array.isArray(bins) ? bins : []).filter((bin) => bin?.type);
    const binsText =
      filteredBins
        .map((bin) => {
          const planOrFrequency = bin.planId ? `plan: ${bin.planId}` : bin.frequency || "";
          return `${bin.count || 1} x ${bin.type} (${planOrFrequency})`;
        })
        .join("\n") || "(none provided)";
    const binsHtml =
      filteredBins
        .map((bin) => {
          const planOrFrequency = bin.planId ? `plan: ${escapeHtml(bin.planId)}` : escapeHtml(bin.frequency || "");
          return `${escapeHtml(bin.count || 1)} x ${escapeHtml(bin.type)} (${planOrFrequency})`;
        })
        .join("<br>") || "(none provided)";
    const pricingBlocks = buildPricingBlocks(pricing, discountCode);

    // These two independent network/CPU operations used to run one after the other.
    const [recaptcha, termsPdfAttachment] = await Promise.all([
      verifyRecaptcha({ token: recaptchaToken, expectedAction: recaptchaAction }),
      buildTermsAcceptancePdfAttachment({
        name,
        email,
        phone,
        address,
        binsText,
        pricingText: pricingBlocks.text,
        termsAccepted,
        termsVersion,
        termsAcceptanceText,
        termsTimestamp,
        termsBody: TERMS_BODY,
        source,
      }).catch((error) => {
        console.warn("Terms PDF generation skipped:", error.message);
        return null;
      }),
    ]);

    if (!recaptcha.ok) {
      console.warn("reCAPTCHA blocked booking:", recaptcha.reason, recaptcha.data || "");
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Anti-bot check failed" }),
      };
    }

    const attachments = termsPdfAttachment ? [termsPdfAttachment] : undefined;
    const subjectAdmin = `🗑️ New Bin Cleaning Booking (${source})`;
    const textAdmin = `New Bin Cleaning Booking\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n${lat != null && lng != null ? `Geo: ${lat}, ${lng}\n` : ""}${placeId ? `Place ID: ${placeId}\n` : ""}Bins:\n${binsText}\n\n${pricingBlocks.text}\n\n— TERMS —\nAccepted: ${termsAccepted ? "yes" : "no"}\nVersion: ${termsVersion}\nConfirmed: ${termsTimestamp}\nAcceptance line: ${termsAcceptanceText}\n`;
    const htmlAdmin = `
      <h2>New Bin Cleaning Booking</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Address:</strong> ${escapeHtml(address)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${lat != null && lng != null ? `<p><strong>Geo:</strong> ${escapeHtml(lat)}, ${escapeHtml(lng)}</p>` : ""}
      ${placeId ? `<p><strong>Place ID:</strong> ${escapeHtml(placeId)}</p>` : ""}
      <p><strong>Bins:</strong><br>${binsHtml}</p>
      ${pricingBlocks.html}
      <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb">
      <div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb">
        <p style="margin:0 0 6px"><strong>TERMS</strong> <span style="color:#6b7280">(v${escapeHtml(termsVersion)})</span></p>
        <p style="margin:0 0 6px"><em>${escapeHtml(termsAcceptanceText)}</em></p>
        ${tosHtmlBlock(termsVersion, termsTimestamp)}
      </div>
      <p style="color:#6b7280;font-size:12px;margin-top:12px">Source: ${escapeHtml(source)}</p>
    `;

    const adminEmailPromise = resend.emails.send({
      from: FROM_DEFAULT,
      to: TO_ADMIN,
      subject: subjectAdmin,
      text: textAdmin,
      html: htmlAdmin,
      replyTo: email || undefined,
      attachments,
    });

    const customerEmailPromise = email
      ? resend.emails.send({
          from: FROM_DEFAULT,
          to: email,
          subject: `🗑️ Booking confirmed — your bin's days are numbered`,
          text: `Thanks ${name},\n\nYour Ni Bin Guy booking is confirmed.\n\nName: ${name}\nPhone: ${phone}\nAddress: ${address}\n\nBins:\n${binsText}\n\n${pricingBlocks.text}\n\nTerms:\nAccepted: ${termsAccepted ? "yes" : "no"}\nVersion: ${termsVersion}\nConfirmed: ${termsTimestamp}\n\n${termsPdfAttachment ? "Your signed Terms & Conditions Acceptance Certificate PDF is attached to this email.\n\n" : ""}We’ll be in touch shortly to confirm your cleaning schedule.`,
          html: buildBookingEmailHtml({
            name,
            address,
            phone,
            bins: filteredBins,
            pricing,
            discountCode,
            termsVersion,
            termsTimestamp,
            termsPdfAttached: Boolean(termsPdfAttachment),
          }),
          replyTo: TO_ADMIN,
          attachments,
        })
      : Promise.resolve({ error: null });

    // Start the optional audit write at the same time as both emails.
    const auditPromise = buildAuditPromise({
      channel: "email",
      name,
      email,
      phone,
      address,
      bins,
      placeId,
      lat,
      lng,
      source,
      discountCode: discountCode || null,
      pricing: pricing || null,
      termsAccepted,
      termsVersion,
      termsAcceptanceText,
      termsTimestamp,
      termsPdfAttached: Boolean(termsPdfAttachment),
      recaptcha: {
        action: recaptchaAction,
        score: recaptcha?.data?.score ?? null,
      },
      createdAt: new Date().toISOString(),
    });

    const [adminResult, customerResult] = await Promise.all([
      adminEmailPromise,
      customerEmailPromise,
      auditPromise,
    ]);

    if (adminResult?.error) {
      console.error("Resend admin error:", adminResult.error);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Failed to send admin email", details: adminResult.error }),
      };
    }

    // The booking is safely received once the admin email succeeds. A customer-email
    // failure should not tell the customer that their booking failed and encourage duplicates.
    if (customerResult?.error) {
      console.error("Resend customer error:", customerResult.error);
    }

    const durationMs = Date.now() - startedAt;
    console.log(`Booking email completed in ${durationMs}ms`);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Server-Timing": `booking;dur=${durationMs}`,
      },
      body: JSON.stringify({
        success: true,
        customerConfirmationSent: !customerResult?.error,
      }),
    };
  } catch (error) {
    console.error("sendBookingEmail failed:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Email send failed" }) };
  }
};