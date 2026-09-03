// WhatsApp submissions use the automatic confirmation pipeline when a clean date
// can be allocated. If scheduling needs manual review, still notify the owner so
// the booking is never lost just because the council/round lookup could not match.
const { Resend } = require("resend");
const { handler: sendAutomaticBookingConfirmation } = require("./sendAutomaticBookingConfirmation");
const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DEFAULT = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";

function getOrigin(event) {
  const headers = event.headers || {};
  const host = headers["x-forwarded-host"] || headers.host || "nibing.uy";
  const proto = headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtGBP(value) {
  const amount = Math.round((Number(value) || 0) * 100) / 100;
  return `£${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
}

function friendlyPlan(bin) {
  const raw = String(bin?.planLabel || bin?.planId || bin?.frequency || "").toLowerCase();
  if (raw.includes("one")) return "One-off clean";
  if (raw.includes("4") || raw.includes("week")) return "Every 4 weeks";
  return bin?.planLabel || bin?.frequency || "Bin clean";
}

async function sendManualBookingOwnerEmail(payload, bins, schedule) {
  const {
    name = "",
    address = "",
    phone = "",
    email = "",
    pricing = null,
    discountCode = null,
    termsAccepted = false,
    termsVersion = "August 2026",
    termsAcceptanceText = `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (vAugust 2026).`,
    termsTimestamp = new Date().toISOString(),
  } = payload;

  const binLines = bins.map((bin) => `${bin.count || 1} x ${bin.type} — ${friendlyPlan(bin)}`);
  const pricingLines = Array.isArray(pricing?.lines)
    ? pricing.lines.map((line) => `${line.count || 1} x ${String(line.type || "").replace(" Bin", "")} — ${line.planLabel || ""} = ${fmtGBP(line.lineTotal)}`)
    : [];

  const scheduleReason = schedule?.reason || schedule?.note || "Automatic clean date could not be confirmed";
  const pricingText = pricingLines.length
    ? `${pricingLines.join("\n")}\nSubtotal: ${fmtGBP(pricing?.subtotal)}\nTotal: ${fmtGBP(pricing?.total)}`
    : `Total: ${fmtGBP(pricing?.total)}`;

  const termsPdfAttachment = await buildTermsAcceptancePdfAttachment({
    name,
    email,
    phone,
    address,
    binsText: binLines.join("\n"),
    pricingText,
    termsAccepted,
    termsVersion,
    termsAcceptanceText,
    termsTimestamp,
    source: "whatsapp-manual",
  }).catch((error) => {
    console.warn("Manual WhatsApp terms PDF skipped:", error.message);
    return null;
  });

  const attachments = termsPdfAttachment ? [termsPdfAttachment] : undefined;
  const subject = `⚠️ WhatsApp booking — date to confirm: ${name || address}`;
  const text = [
    "New WhatsApp Bin Cleaning Booking",
    "",
    "NEXT CLEAN DATE: MANUAL CONFIRMATION REQUIRED",
    `Reason: ${scheduleReason}`,
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Address: ${address}`,
    "",
    "Bins:",
    ...binLines,
    "",
    pricingText,
    "",
    `Discount Code: ${discountCode || "None"}`,
    `Terms accepted: ${termsAccepted ? "yes" : "no"}`,
    `Terms version: ${termsVersion}`,
    `Terms confirmed: ${termsTimestamp}`,
  ].join("\n");

  const binRows = bins.map((bin) => `<li>${escapeHtml(bin.count || 1)} x <strong>${escapeHtml(bin.type)}</strong> — ${escapeHtml(friendlyPlan(bin))}</li>`).join("");
  const priceRows = pricingLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#111;">
      <div style="background:#f59e0b;color:#111;padding:18px 22px;border-radius:12px 12px 0 0;">
        <div style="font-size:22px;font-weight:800;">WhatsApp booking — date to confirm</div>
        <div style="margin-top:4px;font-size:14px;">The booking was received successfully, but the clean date needs manual confirmation.</div>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 12px 12px;">
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Address:</strong> ${escapeHtml(address)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Schedule lookup:</strong> ${escapeHtml(scheduleReason)}</p>
        <h3>Bins</h3>
        <ul>${binRows}</ul>
        ${priceRows ? `<h3>Pricing</h3><ul>${priceRows}</ul>` : ""}
        <p><strong>Subtotal:</strong> ${escapeHtml(fmtGBP(pricing?.subtotal))}<br><strong>Total:</strong> ${escapeHtml(fmtGBP(pricing?.total))}</p>
        <p><strong>Discount Code:</strong> ${escapeHtml(discountCode || "None")}</p>
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:18px 0;">
        <p style="font-size:13px;color:#4b5563;"><strong>Terms:</strong> ${termsAccepted ? "accepted" : "not recorded"} — ${escapeHtml(termsVersion)}<br>${escapeHtml(termsAcceptanceText)}<br>${escapeHtml(termsTimestamp)}</p>
      </div>
    </div>`;

  const result = await resend.emails.send({
    from: FROM_DEFAULT,
    to: TO_ADMIN,
    subject,
    text,
    html,
    replyTo: email || undefined,
    attachments,
  });

  if (result?.error) {
    console.error("Manual WhatsApp owner email failed:", result.error);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Failed to send manual booking owner email", details: result.error }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, automatic: false, ownerNotificationSent: true }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const bins = (Array.isArray(payload.bins) ? payload.bins : []).filter((bin) => bin?.type);

    if (!payload.address || !payload.email || !bins.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing booking details" }) };
    }

    const scheduleResponse = await fetch(`${getOrigin(event)}/api/booking-schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: payload.address,
        bins,
      }),
    });

    const schedule = await scheduleResponse.json().catch(() => null);
    const automatic = Boolean(
      scheduleResponse.ok &&
      schedule?.matched &&
      Array.isArray(schedule?.results) &&
      schedule.results.length &&
      schedule.results.every((result) => result?.automatic && result?.assignedCleanDate)
    );

    if (!automatic) {
      return await sendManualBookingOwnerEmail(payload, bins, schedule);
    }

    return await sendAutomaticBookingConfirmation({
      ...event,
      httpMethod: "POST",
      body: JSON.stringify({
        ...payload,
        source: "whatsapp",
        bins,
        schedule,
      }),
    });
  } catch (error) {
    console.error("sendTosReceipt parity error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send booking confirmation" }),
    };
  }
};
