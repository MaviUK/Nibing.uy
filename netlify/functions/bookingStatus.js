let getStatusStore = null;

try {
  const { getStore } = require("@netlify/blobs");
  getStatusStore = function () {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
    const options = { name: "booking-submission-status", consistency: "strong" };
    if (siteID && token) {
      options.siteID = siteID;
      options.token = token;
    }
    return getStore(options);
  };
} catch (_) {}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const bookingId = String(event.queryStringParameters?.bookingId || "").trim();
  if (!bookingId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "Booking ID is required" }),
    };
  }

  if (!getStatusStore) {
    return {
      statusCode: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "Booking status store unavailable" }),
    };
  }

  try {
    const store = getStatusStore();
    const status = await store.get(bookingId, { type: "json" });

    if (!status) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ bookingId, status: "pending" }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify(status),
    };
  } catch (error) {
    console.error("Booking status lookup failed:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "Could not check booking status" }),
    };
  }
};
