// netlify/functions/sendTosReceipt.js
const { Resend } = require("resend");
const { buildTermsAcceptancePdfAttachment, DEFAULT_TERMS_BODY } = require("./lib/termsPdf");
const { buildBookingEmailHtml } = require("./lib/bookingEmailTemplate");

let getStoreSafe = null;
try {
  const { getStore } = require("@netlify/blobs");
  getStoreSafe = function (name) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
    return siteID && token ? getStore({ name, siteID, token }) : getStore({ name });
  };
} catch (_) {}

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DEFAULT = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";
const TERMS_VERSION_DEFAULT = "August 2026";

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

function buildPricingText(pricing, discountCode) {
  const code = String(discountCode || "").trim();
  const lines = Array.isArray(pricing?.lines) ? pricing.lines : [];
  if (!lines.length) return `Pricing:\n(No pricing breakdown provided)\n\nDiscount Code: ${code || "None"}`;

  const lineText = lines.map((line) => {
    const type = String(line.type || "").replace(" Bin", "");
    const badge = line.discounted ? " (discounted)" : "";
    return `${line.count || 1}x ${type} — ${line.planLabel || ""} @ ${fmtGBP(line.unitPrice)}${badge} = ${fmtGBP(line.lineTotal)}`;
  });

  return `Pricing:\n${lineText.join("\n")}\n\nSubtotal: ${fmtGBP(pricing.subtotal)}\nTotal: ${fmtGBP(pricing.total)}\n\nDiscount Code: ${code || "None"}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const {
      name = "",
      email = "",
      phone = "",
      address = "",
      bins = [],
      source = "whatsapp",
      discountCode = null,
      pricing = null,
      termsAccepted = true,
      termsVersion = TERMS_VERSION_DEFAULT,
      termsAcceptanceText = `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION_DEFAULT}).`,
      termsTimestamp = new Date().toISOString(),
    } = JSON.parse(event.body || "{}");

    const filteredBins = (Array.isArray(bins) ? bins : []).filter((bin) => bin && bin.type);
    const binsText = filteredBins
      .map((bin) => {
        const planOrFreq = bin.planId ? `plan: ${bin.planId}` : bin.frequency || "";
        return `${bin.count || 1} x ${bin.type} (${planOrFreq})`;
      })
      .join("\n") || "(none provided)";

    const pricingText = buildPricingText(pricing, discountCode);

    let termsPdfAttachment = null;
    try {
      termsPdfAttachment = await buildTermsAcceptancePdfAttachment({
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
        termsBody: DEFAULT_TERMS_BODY,
        source,
      });
    } catch (pdfError) {
      console.warn("Terms PDF generation skipped:", pdfError.message);
    }

    const attachments = termsPdfAttachment ? [termsPdfAttachment] : undefined;

    const { error: adminError } = await resend.emails.send({
      from: FROM_DEFAULT,
      to: TO_ADMIN,
      subject: "🗑️ New booking request via WhatsApp",
      text: `New booking request via WhatsApp\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n\nBins:\n${binsText}\n\n${pricingText}\n\nTerms accepted: ${termsAccepted ? "yes" : "no"}\nTerms version: ${termsVersion}\nConfirmed: ${termsTimestamp}`,
      html: `
        <h2>New booking request via WhatsApp</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}<br>
        <strong>Email:</strong> ${escapeHtml(email)}<br>
        <strong>Phone:</strong> ${escapeHtml(phone)}<br>
        <strong>Address:</strong> ${escapeHtml(address)}</p>
        <p><strong>Bins:</strong><br>${escapeHtml(binsText).replace(/\n/g, "<br>")}</p>
        <pre style="white-space:pre-wrap">${escapeHtml(pricingText)}</pre>
        <p><strong>Terms:</strong> ${termsAccepted ? "Accepted" : "Not accepted"} — ${escapeHtml(termsVersion)}</p>
      `,
      replyTo: email || undefined,
      attachments,
    });

    if (adminError) {
      console.error("Resend admin error:", adminError);
      return { statusCode: 502, body: JSON.stringify({ error: "Failed to send admin email", details: adminError }) };
    }

    if (email) {
      const customerHtml = buildBookingEmailHtml({
        name,
        address,
        phone,
        bins: filteredBins,
        pricing,
        discountCode,
        termsVersion,
        termsTimestamp,
        termsPdfAttached: !!termsPdfAttachment,
      });

      const { error: customerError } = await resend.emails.send({
        from: FROM_DEFAULT,
        to: email,
        subject: `Booking request received — Ni Bin Guy`,
        text: `Thanks ${name},\n\nWe’ve received your booking request via WhatsApp.\n\nKeep an eye out for your quote — it will include your clean date and proposed schedule. If everything looks good, hit Confirm at the top of the quote and you’ll be booked in.\n\nAddress: ${address}\n\nBins:\n${binsText}\n\n${pricingText}\n\nYour Terms & Conditions Acceptance Certificate PDF is attached.`,
        html: customerHtml,
        replyTo: TO_ADMIN,
        attachments,
      });

      if (customerError) {
        console.error("Resend customer error:", customerError);
        return { statusCode: 502, body: JSON.stringify({ error: "Failed to send customer email", details: customerError }) };
      }
    }

    if (getStoreSafe) {
      try {
        const store = getStoreSafe("tos-confirmations");
        const key = `${termsTimestamp}__${(email || phone || "unknown").replace(/[^a-z0-9@.+_-]/gi, "_")}.json`;
        await store.setJSON(key, {
          channel: "whatsapp",
          name,
          email,
          phone,
          address,
          bins,
          discountCode: discountCode || null,
          pricing: pricing || null,
          termsAccepted,
          termsVersion,
          termsAcceptanceText,
          termsTimestamp,
          termsPdfAttached: !!termsPdfAttachment,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn("Blobs log skipped:", error.message);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    console.error("sendTosReceipt error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed" }) };
  }
};
