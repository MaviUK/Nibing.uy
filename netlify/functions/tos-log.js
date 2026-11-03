// netlify/functions/tos-log.js
const { getStore } = require("@netlify/blobs");

/* Starter-friendly Blobs loader */
function getStoreSafe(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  return (siteID && token) ? getStore({ name, siteID, token }) : getStore({ name });
}

exports.handler = async (event) => {
  // Allow browser calls
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const store = getStoreSafe("tos-confirmations");
    const data = JSON.parse(event.body || "{}");

    // Minimal validation
    const required = ["termsAccepted", "termsVersion", "termsTimestamp", "channel"];
    const missing = required.filter((k) => !data[k]);
    if (missing.length) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ ok:false, error:"Missing: " + missing.join(", ") }) };
    }

    // Build record
    const nowIso = new Date().toISOString();
    const idBase = (data.email || data.phone || data.name || "anon")
      .toString().toLowerCase().replace(/[^a-z0-9@.+_-]/gi, "");
    const id = `${nowIso}_${idBase || "u"}`; // unique-ish key

    const meta = {
      ip: event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || null,
      ua: event.headers["user-agent"] || null,
    };

    const record = {
      channel: data.channel,                 // "email" | "whatsapp" | "winner"
      name: data.name || null,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      bins: Array.isArray(data.bins) ? data.bins : [],
      placeId: data.placeId || null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,

      // ToS proof
      termsAccepted: Boolean(data.termsAccepted),
      termsVersion: data.termsVersion,
      termsTimestamp: data.termsTimestamp,   // ISO string from client or server
      termsAcceptanceText: data.termsAcceptanceText || null,

      // server meta
      recordedAt: nowIso,
      meta,
    };

    await store.setJSON(id, record);
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, id }) };
  } catch (e) {
    console.error("tos-log error", e);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ ok: false, error: "failed to record ToS" }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}
