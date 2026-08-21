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

function prettyTermsDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

function friendlyPlan(bin) {
  const raw = String(bin?.planLabel || bin?.planId || bin?.frequency || "").toLowerCase();
  if (raw.includes("one")) return "One-off clean";
  if (raw.includes("4") || raw.includes("week")) return "Every 4 weeks";
  return bin?.planLabel || bin?.frequency || "Bin clean";
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
    const binsText = filteredBins.map((bin) => `${bin.count || 1} x ${bin.type} — ${friendlyPlan(bin)}`).join("\n") || "(none provided)";
    const scheduleText = scheduleRows.map((row) => `${row.bin}: ${prettyDate(row.date)}${row.round ? ` (Round ${row.round})` : ""}`).join("\n");
    const total = fmtGBP(pricing?.total || 0);
    const subtotal = fmtGBP(pricing?.subtotal || pricing?.total || 0);
    const firstName = escapeHtml(String(name).trim().split(/\s+/)[0] || "there");
    const priceLines = Array.isArray(pricing?.lines) ? pricing.lines : [];

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

    const bookingRows = filteredBins.length ? filteredBins.map((bin, index) => {
      const row = scheduleRows[index] || scheduleRows.find((item) => String(item.bin).toLowerCase().includes(String(bin.type).toLowerCase()));
      return `
        <tr><td style="padding:13px 0;border-bottom:1px solid #292929;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="font-family:Arial,sans-serif;color:#fff;font-size:16px;font-weight:700;">${escapeHtml(bin.count || 1)} × ${escapeHtml(bin.type)}</td>
            <td align="right" style="font-family:Arial,sans-serif;color:#ffd400;font-size:14px;font-weight:700;">${escapeHtml(friendlyPlan(bin))}</td>
          </tr>${row ? `<tr><td colspan="2" style="padding-top:7px;font-family:Arial,sans-serif;color:#bdbdbd;font-size:13px;">Clean date: <strong style="color:#fff;">${escapeHtml(prettyDate(row.date))}</strong></td></tr>` : ""}</table>
        </td></tr>`;
    }).join("") : scheduleRows.map((row) => `<tr><td style="padding:13px 0;color:#fff;font-family:Arial,sans-serif;"><strong>${escapeHtml(row.bin)}</strong><br><span style="color:#bdbdbd;">${escapeHtml(prettyDate(row.date))}</span></td></tr>`).join("");

    const priceRows = priceLines.length ? priceLines.map((line) => `
      <tr><td style="padding:7px 0;font-family:Arial,sans-serif;color:#fff;font-size:14px;">${escapeHtml(line.count || 1)} × ${escapeHtml(String(line.type || "").replace(" Bin", ""))} — ${escapeHtml(line.planLabel || "")}</td><td align="right" style="padding:7px 0;font-family:Arial,sans-serif;color:#fff;font-size:14px;font-weight:700;">${escapeHtml(fmtGBP(line.lineTotal))}</td></tr>`).join("") : `<tr><td style="padding:7px 0;color:#fff;font-family:Arial,sans-serif;">Booking total</td><td align="right" style="color:#fff;font-family:Arial,sans-serif;font-weight:700;">${escapeHtml(total)}</td></tr>`;

    const customerHtml = `
      <div style="margin:0;padding:0;background:#050505;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${firstName}, your NI Bin Guy booking and clean date are confirmed.</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;margin:0;padding:0;"><tr><td align="center" style="padding:22px 10px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#111;border-radius:18px;overflow:hidden;">
            <tr><td style="background:#050505;padding:26px 28px 18px;text-align:center;">
              <img src="https://nibing.uy/logo.webp" width="190" alt="NI Bin Guy" style="display:block;margin:0 auto 18px;max-width:190px;width:100%;height:auto;border:0;">
              <div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:34px;line-height:1.05;font-weight:900;text-transform:uppercase;">YOUR DIRTY BIN'S DAYS</div>
              <div style="font-family:Arial Black,Arial,sans-serif;color:#ffd400;font-size:38px;line-height:1.05;font-weight:900;text-transform:uppercase;">ARE NUMBERED.</div>
              <div style="font-family:Arial,sans-serif;color:#fff;font-size:16px;line-height:1.5;margin-top:12px;">Nice one, ${firstName} — you're booked in.</div>
            </td></tr>

            <tr><td style="background:#ffd400;padding:18px 24px;text-align:center;">
              <div style="font-family:Arial Black,Arial,sans-serif;color:#050505;font-size:24px;font-weight:900;text-transform:uppercase;">✓ BOOKING CONFIRMED</div>
              <div style="font-family:Arial,sans-serif;color:#050505;font-size:14px;margin-top:4px;font-weight:700;">Your clean date has been allocated and your booking is secured.</div>
            </td></tr>

            <tr><td style="padding:24px 26px 6px;">
              <div style="font-family:Arial,sans-serif;color:#fff;font-size:20px;font-weight:800;">Your clean is booked.</div>
              <div style="font-family:Arial,sans-serif;color:#d1d1d1;font-size:15px;line-height:1.6;margin-top:8px;">We'll send you a reminder before your clean. Please put your bin out for collection as normal and leave it accessible for us afterwards.</div>
            </td></tr>

            <tr><td style="padding:16px 26px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;border-radius:14px;">
              <tr><td style="padding:20px 20px 6px;text-align:center;font-family:Arial Black,Arial,sans-serif;color:#ffd400;font-size:20px;font-weight:900;text-transform:uppercase;">YOUR BOOKING</td></tr>
              <tr><td style="padding:0 20px 4px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${bookingRows}</table></td></tr>
              <tr><td style="padding:16px 20px 20px;"><div style="font-family:Arial,sans-serif;color:#ffd400;font-size:12px;font-weight:700;text-transform:uppercase;">Service address</div><div style="font-family:Arial,sans-serif;color:#fff;font-size:16px;line-height:1.5;padding-top:4px;">${escapeHtml(address)}</div>${phone ? `<div style="font-family:Arial,sans-serif;color:#bdbdbd;font-size:14px;line-height:1.5;padding-top:6px;">${escapeHtml(phone)}</div>` : ""}</td></tr>
            </table></td></tr>

            <tr><td style="padding:14px 26px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b6b44;border:1px solid #14865b;border-radius:14px;"><tr><td style="padding:20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td width="38%" valign="top" style="padding-right:18px;border-right:1px solid #4c9b7b;"><div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:17px;text-transform:uppercase;font-weight:900;">YOUR PRICE</div><div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:52px;line-height:1;font-weight:900;margin-top:7px;">${escapeHtml(total)}</div><div style="font-family:Arial,sans-serif;color:#ffd400;font-size:12px;font-weight:700;text-transform:uppercase;">booking total</div></td>
              <td width="62%" valign="top" style="padding-left:18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${priceRows}</table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #4c9b7b;margin-top:8px;"><tr><td style="padding-top:10px;font-family:Arial,sans-serif;font-size:14px;color:#fff;">Subtotal</td><td align="right" style="padding-top:10px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#fff;">${escapeHtml(subtotal)}</td></tr>${discountCode ? `<tr><td style="padding-top:5px;font-family:Arial,sans-serif;font-size:14px;color:#ffd400;">Discount code</td><td align="right" style="padding-top:5px;font-family:Arial,sans-serif;font-size:14px;color:#ffd400;font-weight:700;">${escapeHtml(discountCode)}</td></tr>` : ""}</table></td>
            </tr></table></td></tr></table></td></tr>

            <tr><td style="padding:28px 26px 8px;text-align:center;"><div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:23px;font-weight:900;text-transform:uppercase;">WHAT HAPPENS NEXT?</div></td></tr>
            <tr><td style="padding:8px 22px 4px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td width="25%" valign="top" align="center" style="padding:7px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;color:#050505;">1</div><div style="font-family:Arial,sans-serif;color:#fff;font-size:13px;font-weight:700;margin-top:8px;">REMINDER</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#aaa;margin-top:4px;">We'll remind you before your clean.</div></td>
              <td width="25%" valign="top" align="center" style="padding:7px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;color:#050505;">2</div><div style="font-family:Arial,sans-serif;color:#fff;font-size:13px;font-weight:700;margin-top:8px;">PUT BIN OUT</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#aaa;margin-top:4px;">Put your bin out as normal.</div></td>
              <td width="25%" valign="top" align="center" style="padding:7px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;color:#050505;">3</div><div style="font-family:Arial,sans-serif;color:#fff;font-size:13px;font-weight:700;margin-top:8px;">BIN EMPTIED</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#aaa;margin-top:4px;">Leave it out once the council empties it.</div></td>
              <td width="25%" valign="top" align="center" style="padding:7px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;color:#050505;">4</div><div style="font-family:Arial,sans-serif;color:#fff;font-size:13px;font-weight:700;margin-top:8px;">BIN CLEANED</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#aaa;margin-top:4px;">We'll clean, disinfect and deodorise it.</div></td>
            </tr></table></td></tr>

            <tr><td style="padding:20px 26px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;border-radius:14px;"><tr><td style="padding:20px;">
              <div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:20px;font-weight:900;text-transform:uppercase;">WE CLEAN BINS.<br><span style="color:#ffd400;">PROPERLY.</span></div>
              <div style="font-family:Arial,sans-serif;color:#bdbdbd;font-size:13px;line-height:1.6;margin-top:8px;">High-pressure cleaning, detergent and deodorising to tackle built-up grime, smells and the mess you'd rather not deal with.</div>
            </td></tr></table></td></tr>

            <tr><td style="padding:14px 26px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#c8102e;border-radius:14px;"><tr><td style="padding:20px;text-align:center;">
              <div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:20px;font-weight:900;text-transform:uppercase;">NEED TO CHANGE SOMETHING?</div>
              <div style="font-family:Arial,sans-serif;color:#fff;font-size:13px;line-height:1.6;margin-top:7px;">No problem — reply to this email and we'll take care of it.</div>
            </td></tr></table></td></tr>

            <tr><td style="padding:14px 26px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#232323;border-radius:14px;"><tr><td style="padding:18px;">
              <div style="font-family:Arial,sans-serif;color:#4cc486;font-size:13px;font-weight:800;">✓ TERMS OF SERVICE CONFIRMED</div>
              <div style="font-family:Arial,sans-serif;color:#ddd;font-size:12px;line-height:1.55;margin-top:7px;">Version: <strong>${escapeHtml(termsVersion)}</strong><br>Confirmed at: <strong>${escapeHtml(prettyTermsDate(termsTimestamp))}</strong>${termsPdfAttachment ? `<br>Your Terms & Conditions Acceptance Certificate PDF is attached to this email.` : ""}</div>
            </td></tr></table></td></tr>

            <tr><td style="padding:26px;text-align:center;background:#050505;">
              <img src="https://nibing.uy/logo.webp" width="100" alt="NI Bin Guy" style="display:block;margin:0 auto 12px;max-width:100px;height:auto;border:0;">
              <div style="font-family:Arial,sans-serif;color:#aaa;font-size:12px;line-height:1.7;">nibing.uy &nbsp;•&nbsp; 07555178484 &nbsp;•&nbsp; info@nibing.uy</div>
              <div style="font-family:Arial,sans-serif;color:#ffd400;font-size:12px;font-weight:700;margin-top:8px;">Thanks for choosing NI Bin Guy — we appreciate you.</div>
            </td></tr>
          </table>
        </td></tr></table>
      </div>`;

    const adminHtml = `
      <h2>Automatically scheduled booking</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Address:</strong> ${escapeHtml(address)}</p>
      <p><strong>Council address:</strong> ${escapeHtml(schedule.councilAddress || "")}</p>
      <p><strong>Schedule:</strong><br>${scheduleRows.map((r) => `${escapeHtml(r.bin)} — ${escapeHtml(prettyDate(r.date))}${r.round ? ` — Round ${escapeHtml(r.round)}` : ""}`).join("<br>")}</p>
      <p><strong>Bins:</strong><br>${filteredBins.map((bin) => `${escapeHtml(bin.count || 1)} × ${escapeHtml(bin.type)} — ${escapeHtml(friendlyPlan(bin))}`).join("<br>")}</p>
      <p><strong>Total:</strong> ${escapeHtml(total)}</p>
      <p style="color:#0b6b44;font-weight:700;">AUTO MATCH — customer was sent the confirmed date automatically.</p>`;

    const [adminResult, customerResult] = await Promise.all([
      resend.emails.send({
        from: FROM_DEFAULT,
        to: TO_ADMIN,
        subject: `✅ Auto-booked: ${name || address}`,
        html: adminHtml,
        text: `Automatically scheduled booking\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n\nBins:\n${binsText}\n\n${scheduleText}\n\nTotal: ${total}`,
        replyTo: email,
        attachments,
      }),
      resend.emails.send({
        from: FROM_DEFAULT,
        to: email,
        subject: `🗑️ Booking confirmed — your first clean is scheduled`,
        html: customerHtml,
        text: `Thanks ${name},\n\nYour NI Bin Guy booking is confirmed.\n\nBins:\n${binsText}\n\n${scheduleText}\n\nAddress: ${address}\nTotal: ${total}\n\nWhat happens next:\n1. Reminder\n2. Put bin out\n3. Bin emptied\n4. Bin cleaned\n\nReply to this email if you need to change anything.`,
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
