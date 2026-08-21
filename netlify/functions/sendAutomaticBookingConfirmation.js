const { Resend } = require("resend");
const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DEFAULT = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";
const TERMS_VERSION_DEFAULT = "July 2026";

const TERMS_BODY = `
Ni Bin Guy – Terms of Service

• Regular 4-weekly plans are based on a 13-clean minimum term, which is approximately 12 months, unless agreed otherwise.
• One-off cleans have no minimum term and may be cancelled up to 24 hours before the scheduled clean day without charge.
• Bins must be left out or made accessible on the scheduled cleaning day and must remain available until 8pm.
• If your bin is not available when we attend, or access is blocked, the clean may still be charged.
• If we are unable to attend on the scheduled day, we will notify you and rearrange the clean as soon as reasonably possible.
• Payment is due within 7 days unless agreed otherwise. Accepted methods are Direct Debit, Bank Transfer, and Card. No cash.
• Cancelling a Direct Debit does not cancel your service or contract.
• You consent to us storing your details and contacting you about your booking, schedule, payment, and service.
`;

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const fmtGBP = (value) => {
  const amount = Math.round((Number(value) || 0) * 100) / 100;
  return `£${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
};

function prettyDate(value) {
  if (!value) return "";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const {
      name = "",
      address = "",
      phone = "",
      email = "",
      bins = [],
      pricing = null,
      discountCode = null,
      termsAccepted = false,
      termsVersion = TERMS_VERSION_DEFAULT,
      termsAcceptanceText = `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION_DEFAULT}).`,
      termsTimestamp = new Date().toISOString(),
      schedule = null,
    } = payload;

    if (!email || !schedule?.matched || !Array.isArray(schedule?.results) || !schedule.results.length || !schedule.results.every((r) => r.automatic && r.assignedCleanDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Automatic schedule not confirmed" }) };
    }

    const filteredBins = (Array.isArray(bins) ? bins : []).filter((bin) => bin?.type);
    const scheduleRows = schedule.results.map((result) => ({
      bin: result.bin,
      date: result.assignedCleanDate,
      round: result.round?.round || "",
    }));
    const binsText = filteredBins.map((bin) => `${bin.count || 1} x ${bin.type}`).join("\n") || "(none provided)";
    const scheduleText = scheduleRows.map((row) => `${row.bin}: ${prettyDate(row.date)}${row.round ? ` (Round ${row.round})` : ""}`).join("\n");
    const total = fmtGBP(pricing?.total || 0);

    const termsPdfAttachment = await buildTermsAcceptancePdfAttachment({
      name,
      email,
      phone,
      address,
      binsText,
      pricingText: `Total: ${total}`,
      termsAccepted,
      termsVersion,
      termsAcceptanceText,
      termsTimestamp,
      termsBody: TERMS_BODY,
      source: "website-auto",
    }).catch(() => null);
    const attachments = termsPdfAttachment ? [termsPdfAttachment] : undefined;

    const scheduleHtml = scheduleRows.map((row) => `
      <div style="background:#111;border-radius:12px;padding:16px 18px;margin:10px 0;color:#fff;">
        <div style="font:700 14px Arial,sans-serif;color:#ffd400;text-transform:uppercase;">${escapeHtml(row.bin)}</div>
        <div style="font:900 24px Arial,sans-serif;margin-top:5px;">${escapeHtml(prettyDate(row.date))}</div>
      </div>`).join("");

    const customerHtml = `
      <div style="margin:0;background:#050505;padding:24px 10px;font-family:Arial,sans-serif;">
        <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;">
          <div style="background:#050505;text-align:center;padding:26px;">
            <img src="https://nibing.uy/logo.webp" width="190" alt="Ni Bin Guy" style="max-width:190px;width:100%;height:auto;">
            <div style="color:#fff;font-size:30px;font-weight:900;margin-top:18px;text-transform:uppercase;">You're booked.</div>
            <div style="color:#ffd400;font-size:34px;font-weight:900;text-transform:uppercase;">Your clean date is confirmed.</div>
          </div>
          <div style="background:#ffd400;color:#050505;padding:16px 24px;text-align:center;font-weight:900;font-size:20px;">✓ BOOKING CONFIRMED</div>
          <div style="padding:26px;">
            <p style="font-size:17px;line-height:1.6;margin-top:0;">Hi ${escapeHtml(String(name).trim().split(/\s+/)[0] || "there")}, your NI Bin Guy booking has been automatically scheduled using your council bin collection calendar and our cleaning round.</p>
            ${scheduleHtml}
            <div style="background:#0b6b44;color:#fff;border-radius:12px;padding:18px;margin-top:20px;">
              <div style="font-size:12px;font-weight:700;color:#ffd400;text-transform:uppercase;">Service address</div>
              <div style="font-size:16px;margin-top:5px;">${escapeHtml(address)}</div>
              <div style="font-size:12px;font-weight:700;color:#ffd400;text-transform:uppercase;margin-top:14px;">Booking total</div>
              <div style="font-size:28px;font-weight:900;margin-top:3px;">${escapeHtml(total)}</div>
              ${discountCode ? `<div style="font-size:13px;margin-top:5px;">Discount: ${escapeHtml(discountCode)}</div>` : ""}
            </div>
            <p style="font-size:15px;line-height:1.6;color:#333;">Put your bin out for council collection as normal and leave it available for us afterwards on the confirmed cleaning day.</p>
            ${termsPdfAttachment ? `<p style="font-size:13px;color:#666;">Your Terms & Conditions Acceptance Certificate is attached.</p>` : ""}
          </div>
        </div>
      </div>`;

    const adminHtml = `
      <h2>Automatically scheduled booking</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Address:</strong> ${escapeHtml(address)}</p>
      <p><strong>Council address:</strong> ${escapeHtml(schedule.councilAddress || "")}</p>
      <p><strong>Schedule:</strong><br>${scheduleRows.map((r) => `${escapeHtml(r.bin)} — ${escapeHtml(prettyDate(r.date))}${r.round ? ` — Round ${escapeHtml(r.round)}` : ""}`).join("<br>")}</p>
      <p><strong>Total:</strong> ${escapeHtml(total)}</p>
      <p style="color:#0b6b44;font-weight:700;">AUTO MATCH — customer was sent the confirmed date automatically.</p>`;

    const [adminResult, customerResult] = await Promise.all([
      resend.emails.send({
        from: FROM_DEFAULT,
        to: TO_ADMIN,
        subject: `✅ Auto-booked: ${name || address}`,
        html: adminHtml,
        text: `Automatically scheduled booking\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n\n${scheduleText}\n\nTotal: ${total}`,
        replyTo: email,
        attachments,
      }),
      resend.emails.send({
        from: FROM_DEFAULT,
        to: email,
        subject: `🗑️ Booking confirmed — your first clean is scheduled`,
        html: customerHtml,
        text: `Thanks ${name},\n\nYour NI Bin Guy booking is confirmed.\n\n${scheduleText}\n\nAddress: ${address}\nTotal: ${total}\n\nPut your bin out for council collection as normal and leave it available for us afterwards on the confirmed cleaning day.`,
        replyTo: TO_ADMIN,
        attachments,
      }),
    ]);

    if (adminResult?.error) return { statusCode: 502, body: JSON.stringify({ error: "Failed to send admin email" }) };
    if (customerResult?.error) return { statusCode: 502, body: JSON.stringify({ error: "Failed to send customer confirmation" }) };

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, automatic: true, schedule }) };
  } catch (error) {
    console.error("Automatic booking confirmation failed", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Automatic confirmation failed" }) };
  }
};
