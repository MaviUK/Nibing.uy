const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DEFAULT = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const { name = "", address = "", postcode = "", schedule = null } = payload;

    if (!address || !schedule) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing audit data" }) };
    }

    const results = Array.isArray(schedule?.results) ? schedule.results : [];
    const rows = results.map((item) => {
      const round = item?.round || {};
      return {
        bin: item?.bin || "Unknown",
        councilDates: Array.isArray(item?.councilDates) ? item.councilDates.join(", ") : "—",
        round: round?.round || "—",
        roundNext: round?.nextCleanDate || "—",
        assigned: item?.assignedCleanDate || "—",
        status: item?.automatic ? "AUTO MATCH" : round?.ambiguous ? "AMBIGUOUS" : "MANUAL REVIEW",
        confidence: round?.confidence || "—",
      };
    });

    const textRows = rows.length
      ? rows.map((row) => `${row.bin}: ${row.status} | Council ${row.councilDates} | Round ${row.round} | Round next ${row.roundNext} | Assigned ${row.assigned} | Confidence ${row.confidence}`).join("\n")
      : `No automatic result: ${schedule?.reason || "unknown reason"}`;

    const htmlRows = rows.length
      ? rows.map((row) => `<tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.bin)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb"><strong>${escapeHtml(row.status)}</strong></td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.councilDates)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.round)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.roundNext)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.assigned)}</td>
        </tr>`).join("")
      : `<tr><td colspan="6" style="padding:10px">${escapeHtml(schedule?.reason || "No result")}</td></tr>`;

    await resend.emails.send({
      from: FROM_DEFAULT,
      to: TO_ADMIN,
      subject: `Council + round audit: ${name || address}`,
      text: `Automatic booking schedule audit\n\nCustomer: ${name || "—"}\nAddress: ${address}\nPostcode: ${postcode || "—"}\nCouncil address: ${schedule?.councilAddress || "—"}\n\n${textRows}\n\nInternal test only. Dates are not yet sent to the customer.`,
      html: `
        <h2>Automatic booking schedule audit</h2>
        <p><strong>Customer:</strong> ${escapeHtml(name || "—")}</p>
        <p><strong>Address:</strong> ${escapeHtml(address)}</p>
        <p><strong>Postcode:</strong> ${escapeHtml(postcode || "—")}</p>
        <p><strong>Council address:</strong> ${escapeHtml(schedule?.councilAddress || "—")}</p>
        <table style="border-collapse:collapse;width:100%;margin-top:16px">
          <thead><tr>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Bin</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Result</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Council dates</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Round</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Round next</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Assigned</th>
          </tr></thead>
          <tbody>${htmlRows}</tbody>
        </table>
        <p style="margin-top:16px;color:#6b7280;font-size:13px">Internal test only — these dates have not been sent to the customer.</p>
      `,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    console.error("Round audit email failed", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Audit email failed" }) };
  }
};
