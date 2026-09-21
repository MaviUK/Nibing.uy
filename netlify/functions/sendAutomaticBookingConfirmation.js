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

function normaliseBinName(value) {
  return String(value || "").toLowerCase().replace(/\s+bin\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
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

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: "Customer email is required" }) };
    }

    const filteredBins = (Array.isArray(bins) ? bins : []).filter((bin) => bin?.type);
    if (!filteredBins.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "At least one bin is required" }) };
    }

    const scheduleResults = Array.isArray(schedule?.results) ? schedule.results : [];
    const scheduleRows = filteredBins.map((bin, index) => {
      const wanted = normaliseBinName(bin.type);
      const result =
        scheduleResults[index] ||
        scheduleResults.find((item) => normaliseBinName(item?.bin) === wanted) ||
        scheduleResults.find((item) => {
          const candidate = normaliseBinName(item?.bin);
          return candidate && wanted && (candidate.includes(wanted) || wanted.includes(candidate));
        }) ||
        null;

      return {
        bin: result?.bin || bin.type,
        date: result?.assignedCleanDate || null,
        automatic: Boolean(result?.automatic && result?.assignedCleanDate),
        round: result?.round?.round || "",
      };
    });

    const automatic = scheduleRows.length > 0 && scheduleRows.every((row) => row.automatic && row.date);
    const confirmedCount = scheduleRows.filter((row) => row.date).length;
    const someConfirmed = confirmedCount > 0 && !automatic;
    const bookingStatusHeading = automatic ? "✓ BOOKING CONFIRMED" : "✓ BOOKING RECEIVED";
    const bookingStatusText = automatic
      ? "Your clean date has been allocated and your booking is secured."
      : someConfirmed
        ? "Some clean dates have been allocated. We'll confirm the remaining date or dates manually."
        : "We couldn't automatically match your clean date. We'll confirm it manually.";
    const introHeading = automatic ? "Your clean is booked." : "We've got your booking.";
    const introText = automatic
      ? "We'll send you a reminder before your clean. Please put your bin out for collection as normal and leave it accessible for us afterwards."
      : someConfirmed
        ? "The dates we could match are shown below. We'll confirm the remaining clean date manually, so you don't need to submit the booking again."
        : "We'll check your bin collection day and our round, then confirm your clean date manually. You don't need to submit the booking again.";
    const preheader = automatic
      ? `${String(name).trim().split(/\s+/)[0] || "Your"} NI Bin Guy booking and clean date are confirmed.`
      : `${String(name).trim().split(/\s+/)[0] || "Your"} NI Bin Guy booking has been received. We'll confirm the clean date manually.`;
    const adminHeading = automatic ? "Automatically scheduled booking" : "Booking received — date confirmation needed";
    const adminStatusText = automatic
      ? "AUTO MATCH — customer was sent the confirmed date automatically."
      : someConfirmed
        ? "PARTIAL MATCH — customer was shown the confirmed date(s) and told the remaining date(s) will be confirmed manually."
        : "MANUAL DATE CONFIRMATION — booking was received successfully and the customer was told the clean date will be confirmed manually.";
    const adminSubject = automatic
      ? `✅ Auto-booked: ${name || address}`
      : `🕒 Booking received — date to confirm: ${name || address}`;
    const customerSubject = automatic
      ? "🗑️ Booking confirmed — your first clean is scheduled"
      : "🗑️ Booking received — clean date to be confirmed";

    const binsText = filteredBins.map((bin) => `${bin.count || 1} x ${bin.type} — ${friendlyPlan(bin)}`).join("\n") || "(none provided)";
    const scheduleText = scheduleRows.map((row) => `${row.bin}: ${row.date ? prettyDate(row.date) : "Date to be confirmed"}${row.round ? ` (Round ${row.round})` : ""}`).join("\n");
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
      source: automatic ? "website-auto" : "website-manual-date",
    }).catch(() => null);
    const attachments = termsPdfAttachment ? [termsPdfAttachment] : undefined;

    const bookingRows = filteredBins.map((bin, index) => {
      const row = scheduleRows[index];
      const cleanDateText = row?.date ? prettyDate(row.date) : "To be confirmed";
      const cleanDateColour = row?.date ? "#fff" : "#ffd400";
      return `
        <tr><td style="padding:13px 0;border-bottom:1px solid #292929;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="font-family:Arial,sans-serif;color:#fff;font-size:16px;font-weight:700;">${escapeHtml(bin.count || 1)} × ${escapeHtml(bin.type)}</td>
            <td align="right" style="font-family:Arial,sans-serif;color:#ffd400;font-size:14px;font-weight:700;">${escapeHtml(friendlyPlan(bin))}</td>
          </tr><tr><td colspan="2" style="padding-top:7px;font-family:Arial,sans-serif;color:#bdbdbd;font-size:13px;">Clean date: <strong style="color:${cleanDateColour};">${escapeHtml(cleanDateText)}</strong></td></tr></table>
        </td></tr>`;
    }).join("");

    const priceRows = priceLines.length ? priceLines.map((line) => `
      <tr><td style="padding:7px 0;font-family:Arial,sans-serif;color:#fff;font-size:14px;">${escapeHtml(line.count || 1)} × ${escapeHtml(String(line.type || "").replace(" Bin", ""))} — ${escapeHtml(line.planLabel || "")}</td><td align="right" style="padding:7px 0;font-family:Arial,sans-serif;color:#fff;font-size:14px;font-weight:700;">${escapeHtml(fmtGBP(line.lineTotal))}</td></tr>`).join("") : `<tr><td style="padding:7px 0;color:#fff;font-family:Arial,sans-serif;">Booking total</td><td align="right" style="color:#fff;font-family:Arial,sans-serif;font-weight:700;">${escapeHtml(total)}</td></tr>`;

    const customerHtml = `
      <div style="margin:0;padding:0;background:#050505;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;margin:0;padding:0;"><tr><td align="center" style="padding:22px 10px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#111;border-radius:18px;overflow:hidden;">
            <tr><td style="background:#050505;padding:26px 28px 18px;text-align:center;">
              <img src="https://nibing.uy/logo.webp" width="190" alt="NI Bin Guy" style="display:block;margin:0 auto 18px;max-width:190px;width:100%;height:auto;border:0;">
              <div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:34px;line-height:1.05;font-weight:900;text-transform:uppercase;">YOUR DIRTY BIN'S DAYS</div>
              <div style="font-family:Arial Black,Arial,sans-serif;color:#ffd400;font-size:38px;line-height:1.05;font-weight:900;text-transform:uppercase;">ARE NUMBERED.</div>
              <div style="font-family:Arial,sans-serif;color:#fff;font-size:16px;line-height:1.5;margin-top:12px;">Nice one, ${firstName} — you're booked in.</div>
            </td></tr>

            <tr><td style="background:#ffd400;padding:18px 24px;text-align:center;">
              <div style="font-family:Arial Black,Arial,sans-serif;color:#050505;font-size:24px;font-weight:900;text-transform:uppercase;">${escapeHtml(bookingStatusHeading)}</div>
              <div style="font-family:Arial,sans-serif;color:#050505;font-size:14px;margin-top:4px;font-weight:700;">${escapeHtml(bookingStatusText)}</div>
            </td></tr>

            <tr><td style="padding:24px 26px 6px;">
              <div style="font-family:Arial,sans-serif;color:#fff;font-size:20px;font-weight:800;">${escapeHtml(introHeading)}</div>
              <div style="font-family:Arial,sans-serif;color:#d1d1d1;font-size:15px;line-height:1.6;margin-top:8px;">${escapeHtml(introText)}</div>
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
              <td width="25%" valign="top" align="center" style="padding:7px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;color:#050505;">1</div><div style="font-family:Arial,sans-serif;color:#fff;font-size:13px;font-weight:700;margin-top:8px;">${automatic ? "REMINDER" : "DATE CONFIRMATION"}</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#aaa;margin-top:4px;">${automatic ? "We'll remind you before your clean." : "We'll confirm your clean date shortly."}</div></td>
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
      <h2>${escapeHtml(adminHeading)}</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Address:</strong> ${escapeHtml(address)}</p>
      <p><strong>Council address:</strong> ${escapeHtml(schedule?.councilAddress || "Not confirmed")}</p>
      <p><strong>Schedule:</strong><br>${scheduleRows.map((r) => `${escapeHtml(r.bin)} — ${escapeHtml(r.date ? prettyDate(r.date) : "Date to be confirmed")}${r.round ? ` — Round ${escapeHtml(r.round)}` : ""}`).join("<br>")}</p>
      <p><strong>Bins:</strong><br>${filteredBins.map((bin) => `${escapeHtml(bin.count || 1)} × ${escapeHtml(bin.type)} — ${escapeHtml(friendlyPlan(bin))}`).join("<br>")}</p>
      <p><strong>Total:</strong> ${escapeHtml(total)}</p>
      <p style="color:${automatic ? "#0b6b44" : "#b45309"};font-weight:700;">${escapeHtml(adminStatusText)}</p>`;

    const [adminResult, customerResult] = await Promise.all([
      resend.emails.send({
        from: FROM_DEFAULT,
        to: TO_ADMIN,
        subject: adminSubject,
        html: adminHtml,
        text: `${adminHeading}\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n\nBins:\n${binsText}\n\n${scheduleText}\n\nTotal: ${total}\n\n${adminStatusText}`,
        replyTo: email,
        attachments,
      }),
      resend.emails.send({
        from: FROM_DEFAULT,
        to: email,
        subject: customerSubject,
        html: customerHtml,
        text: `Thanks ${name},\n\n${automatic ? "Your NI Bin Guy booking is confirmed." : "Your NI Bin Guy booking has been received. We’ll confirm any outstanding clean date manually."}\n\nBins:\n${binsText}\n\n${scheduleText}\n\nAddress: ${address}\nTotal: ${total}\n\nWhat happens next:\n1. ${automatic ? "Reminder" : "Date confirmation"}\n2. Put bin out\n3. Bin emptied\n4. Bin cleaned\n\nReply to this email if you need to change anything.`,
        replyTo: TO_ADMIN,
        attachments,
      }),
    ]);

    if (adminResult?.error) return { statusCode: 502, body: JSON.stringify({ error: "Failed to send admin email" }) };
    if (customerResult?.error) return { statusCode: 502, body: JSON.stringify({ error: "Failed to send customer confirmation" }) };

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, automatic, schedule }) };
  } catch (error) {
    console.error("Automatic booking confirmation failed", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Automatic confirmation failed" }) };
  }
};
