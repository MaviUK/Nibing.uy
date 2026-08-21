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
    const { name = "", address = "", postcode = "", checks = [] } = payload;

    if (!address || !Array.isArray(checks) || !checks.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing audit data" }) };
    }

    const rows = checks.map((check) => {
      const matched = Boolean(check?.matched);
      const status = matched ? "MATCHED" : check?.ambiguous ? "AMBIGUOUS" : "NO MATCH";
      return {
        bin: check?.requestedBin || check?.bin || "Unknown",
        status,
        round: check?.round || "—",
        date: check?.nextCleanDate || "—",
        confidence: check?.confidence || "—",
      };
    });

    const textRows = rows
      .map((row) => `${row.bin}: ${row.status} | Round ${row.round} | Next ${row.date} | Confidence ${row.confidence}`)
      .join("\n");

    const htmlRows = rows
      .map(
        (row) => `<tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.bin)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb"><strong>${escapeHtml(row.status)}</strong></td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.round)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.date)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.confidence)}</td>
        </tr>`
      )
      .join("");

    await resend.emails.send({
      from: FROM_DEFAULT,
      to: TO_ADMIN,
      subject: `Round audit: ${name || address}`,
      text: `Automatic round audit\n\nCustomer: ${name || "—"}\nAddress: ${address}\nPostcode: ${postcode || "—"}\n\n${textRows}\n\nThis is an internal test only. The customer has not been sent these dates.`,
      html: `
        <h2>Automatic round audit</h2>
        <p><strong>Customer:</strong> ${escapeHtml(name || "—")}</p>
        <p><strong>Address:</strong> ${escapeHtml(address)}</p>
        <p><strong>Postcode:</strong> ${escapeHtml(postcode || "—")}</p>
        <table style="border-collapse:collapse;width:100%;margin-top:16px">
          <thead><tr>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Bin</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Result</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Round</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Next clean</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #111827">Confidence</th>
          </tr></thead>
          <tbody>${htmlRows}</tbody>
        </table>
        <p style="margin-top:16px;color:#6b7280;font-size:13px">Internal test only — these dates were not sent to the customer.</p>
      `,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    console.error("Round audit email failed", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Audit email failed" }) };
  }
};
