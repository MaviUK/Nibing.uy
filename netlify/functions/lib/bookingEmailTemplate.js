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

function formatTermsDate(timestampIso) {
  if (!timestampIso) return "—";
  return new Date(timestampIso).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

function friendlyPlan(bin) {
  const raw = String(bin?.planId || bin?.frequency || "").toLowerCase();
  if (raw.includes("4w")) return "Every 4 weeks";
  if (raw.includes("one")) return "One-off clean";
  return bin?.planId || bin?.frequency || "Bin clean";
}

function buildBookingEmailHtml({
  name,
  address,
  phone,
  bins,
  pricing,
  discountCode,
  termsVersion,
  termsTimestamp,
  termsPdfAttached,
}) {
  const safeName = escapeHtml(name || "there");
  const firstName = escapeHtml(String(name || "there").trim().split(/\s+/)[0] || "there");
  const filteredBins = (Array.isArray(bins) ? bins : []).filter((bin) => bin?.type);
  const lines = Array.isArray(pricing?.lines) ? pricing.lines : [];
  const total = fmtGBP(pricing?.total || 0);
  const subtotal = fmtGBP(pricing?.subtotal || pricing?.total || 0);
  const code = String(discountCode || "").trim();
  const logoUrl = "https://nibing.uy/logo.webp";

  const binCards = filteredBins.length
    ? filteredBins
        .map((bin) => `
          <tr>
            <td style="padding:14px 0;border-bottom:1px solid #292929;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-family:Arial,sans-serif;color:#ffffff;font-size:17px;font-weight:700;">${escapeHtml(bin.count || 1)} × ${escapeHtml(bin.type)}</td>
                  <td align="right" style="font-family:Arial,sans-serif;color:#ffd400;font-size:15px;font-weight:700;">${escapeHtml(friendlyPlan(bin))}</td>
                </tr>
              </table>
            </td>
          </tr>`)
        .join("")
    : `<tr><td style="padding:12px 0;color:#ffffff;font-family:Arial,sans-serif;">Your selected bin clean</td></tr>`;

  const priceRows = lines.length
    ? lines
        .map((line) => `
          <tr>
            <td style="padding:8px 0;font-family:Arial,sans-serif;color:#111111;font-size:15px;">${escapeHtml(line.count || 1)} × ${escapeHtml(String(line.type || "").replace(" Bin", ""))} — ${escapeHtml(line.planLabel || "")}</td>
            <td align="right" style="padding:8px 0;font-family:Arial,sans-serif;color:#111111;font-size:15px;font-weight:700;">${escapeHtml(fmtGBP(line.lineTotal))}</td>
          </tr>`)
        .join("")
    : `<tr><td style="padding:8px 0;font-family:Arial,sans-serif;color:#111111;">Booking total</td><td align="right" style="font-family:Arial,sans-serif;font-weight:700;">${escapeHtml(total)}</td></tr>`;

  return `
  <div style="margin:0;padding:0;background:#050505;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Nice one ${safeName} — your Ni Bin Guy booking is confirmed.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#050505;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:22px 10px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#050505;padding:26px 28px 18px;text-align:center;">
                <img src="${logoUrl}" width="190" alt="Ni Bin Guy" style="display:block;margin:0 auto 18px;max-width:190px;width:100%;height:auto;border:0;">
                <div style="font-family:Arial Black,Arial,sans-serif;color:#ffffff;font-size:34px;line-height:1.05;font-weight:900;text-transform:uppercase;letter-spacing:-1px;">YOUR BIN'S DAYS</div>
                <div style="font-family:Arial Black,Arial,sans-serif;color:#ffd400;font-size:38px;line-height:1.05;font-weight:900;text-transform:uppercase;letter-spacing:-1px;">ARE NUMBERED.</div>
                <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:17px;line-height:1.5;margin-top:12px;">Nice one, ${firstName} — you're booked in.</div>
              </td>
            </tr>
            <tr>
              <td style="background:#ffd400;padding:18px 24px;text-align:center;">
                <div style="font-family:Arial Black,Arial,sans-serif;color:#050505;font-size:24px;font-weight:900;text-transform:uppercase;">✓ BOOKING CONFIRMED</div>
                <div style="font-family:Arial,sans-serif;color:#050505;font-size:14px;margin-top:4px;font-weight:700;">We've got your details and we'll confirm your cleaning schedule shortly.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 26px 8px;">
                <div style="font-family:Arial Black,Arial,sans-serif;color:#111111;font-size:26px;font-weight:900;text-transform:uppercase;">NICE ONE, ${firstName.toUpperCase()}!</div>
                <div style="font-family:Arial,sans-serif;color:#c41230;font-size:18px;font-weight:700;margin-top:5px;">Your first clean is on its way.</div>
                <div style="font-family:Arial,sans-serif;color:#333333;font-size:15px;line-height:1.6;margin-top:10px;">Keep an eye out for your quote — it will show your first clean date and your proposed schedule. If everything looks good, simply tap the <strong>Confirm</strong> button at the top of the quote and your booking will be secured.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;border-radius:14px;">
                  <tr><td style="padding:20px 20px 6px;text-align:center;font-family:Arial Black,Arial,sans-serif;color:#ffd400;font-size:20px;font-weight:900;text-transform:uppercase;">YOUR BOOKING</td></tr>
                  <tr><td style="padding:0 20px 4px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${binCards}</table></td></tr>
                  <tr>
                    <td style="padding:16px 20px 20px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr><td style="font-family:Arial,sans-serif;color:#ffd400;font-size:12px;font-weight:700;text-transform:uppercase;">Service address</td></tr>
                        <tr><td style="font-family:Arial,sans-serif;color:#ffffff;font-size:16px;line-height:1.5;padding-top:4px;">${escapeHtml(address)}</td></tr>
                        ${phone ? `<tr><td style="font-family:Arial,sans-serif;color:#bdbdbd;font-size:14px;line-height:1.5;padding-top:6px;">${escapeHtml(phone)}</td></tr>` : ""}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 26px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffd400;border-radius:14px;">
                  <tr>
                    <td style="padding:20px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td width="38%" valign="top" style="padding-right:18px;border-right:1px solid rgba(0,0,0,.25);">
                            <div style="font-family:Arial Black,Arial,sans-serif;color:#111111;font-size:17px;text-transform:uppercase;font-weight:900;">YOUR PRICE</div>
                            <div style="font-family:Arial Black,Arial,sans-serif;color:#111111;font-size:52px;line-height:1;font-weight:900;margin-top:7px;">${escapeHtml(total)}</div>
                            <div style="font-family:Arial,sans-serif;color:#111111;font-size:12px;font-weight:700;text-transform:uppercase;">booking total</div>
                          </td>
                          <td width="62%" valign="top" style="padding-left:18px;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${priceRows}</table>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid rgba(0,0,0,.25);margin-top:8px;">
                              <tr><td style="padding-top:10px;font-family:Arial,sans-serif;font-size:14px;">Subtotal</td><td align="right" style="padding-top:10px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;">${escapeHtml(subtotal)}</td></tr>
                              ${code ? `<tr><td style="padding-top:5px;font-family:Arial,sans-serif;font-size:14px;color:#a00018;">Discount code</td><td align="right" style="padding-top:5px;font-family:Arial,sans-serif;font-size:14px;color:#a00018;font-weight:700;">${escapeHtml(code)}</td></tr>` : ""}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 26px 4px;text-align:center;">
                <div style="font-family:Arial Black,Arial,sans-serif;color:#111111;font-size:23px;font-weight:900;text-transform:uppercase;">WHAT HAPPENS NEXT?</div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 20px 6px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="20%" valign="top" align="center" style="padding:6px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;">1</div><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;margin-top:8px;">GET YOUR QUOTE</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#555;margin-top:4px;">We'll send your clean date and schedule.</div></td>
                    <td width="20%" valign="top" align="center" style="padding:6px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;">2</div><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;margin-top:8px;">CONFIRM IT</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#555;margin-top:4px;">Hit Confirm at the top of the quote.</div></td>
                    <td width="20%" valign="top" align="center" style="padding:6px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;">3</div><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;margin-top:8px;">BIN EMPTIED</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#555;margin-top:4px;">Put it out as normal.</div></td>
                    <td width="20%" valign="top" align="center" style="padding:6px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;">4</div><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;margin-top:8px;">WE CLEAN IT</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#555;margin-top:4px;">Leave it accessible and we'll do the rest.</div></td>
                    <td width="20%" valign="top" align="center" style="padding:6px;"><div style="width:30px;height:30px;line-height:30px;background:#ffd400;border-radius:50%;font-family:Arial,sans-serif;font-weight:900;">5</div><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;margin-top:8px;">FRESH BIN</div><div style="font-family:Arial,sans-serif;font-size:11px;line-height:1.4;color:#555;margin-top:4px;">Clean, disinfected and deodorised.</div></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;border-radius:14px;">
                  <tr><td style="padding:18px 20px 6px;font-family:Arial Black,Arial,sans-serif;color:#ffffff;font-size:22px;font-weight:900;text-transform:uppercase;">WE CLEAN BINS. <span style="color:#ffd400;">PROPERLY.</span></td></tr>
                  <tr><td style="padding:0 20px 18px;font-family:Arial,sans-serif;color:#d8d8d8;font-size:13px;line-height:1.6;">High-pressure cleaning, detergent and deodorising to tackle built-up grime, smells and the mess you'd rather not deal with.</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 26px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#c41230;border-radius:14px;">
                  <tr><td style="padding:18px 20px;text-align:center;font-family:Arial,sans-serif;color:#ffffff;"><div style="font-size:20px;font-weight:900;text-transform:uppercase;">NEED TO CHANGE SOMETHING?</div><div style="font-size:14px;line-height:1.5;margin-top:5px;">No problem — just reply to this email and we'll take care of it.</div></td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f4;border-radius:14px;">
                  <tr>
                    <td style="padding:18px 20px;font-family:Arial,sans-serif;color:#222222;">
                      <div style="font-size:15px;font-weight:900;color:#147a2e;text-transform:uppercase;">✓ TERMS OF SERVICE CONFIRMED</div>
                      <div style="font-size:13px;line-height:1.6;margin-top:7px;">Version: <strong>${escapeHtml(termsVersion)}</strong><br>Confirmed at: <strong>${escapeHtml(formatTermsDate(termsTimestamp))}</strong></div>
                      <div style="font-size:12px;line-height:1.5;color:#666666;margin-top:7px;">${termsPdfAttached ? "Your signed Terms & Conditions Acceptance Certificate PDF is attached to this email." : "Your Terms acceptance has been recorded with your booking."}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:#050505;padding:20px;text-align:center;">
                <img src="${logoUrl}" width="110" alt="Ni Bin Guy" style="display:block;margin:0 auto 10px;max-width:110px;width:100%;height:auto;border:0;">
                <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:12px;line-height:1.8;">nibing.uy &nbsp; • &nbsp; 07555 178484 &nbsp; • &nbsp; info@nibing.uy</div>
                <div style="font-family:Arial,sans-serif;color:#ffd400;font-size:13px;margin-top:8px;font-weight:700;">Thanks for choosing Ni Bin Guy — we appreciate you.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}

module.exports = { buildBookingEmailHtml };
