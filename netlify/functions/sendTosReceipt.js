// WhatsApp submissions use the same confirmation pipeline as email submissions.
const { handler: sendAutomaticBookingConfirmation } = require("./sendAutomaticBookingConfirmation");

function getOrigin(event) {
  const headers = event.headers || {};
  const host = headers["x-forwarded-host"] || headers.host || "nibing.uy";
  const proto = headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
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
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: "Automatic schedule not confirmed",
          details: schedule || null,
        }),
      };
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
