/*
 * Preview-only, server-side Google Places (New) suggestions.
 * Keeps the API key off the client and works on deploy-preview hostnames
 * without relying on the Google Maps JavaScript bootstrap.
 */
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const reply = (code, body) => ({ statusCode: code, headers, body: JSON.stringify(body) });
const hits = new Map();
function allow(ip) {
  const now = Date.now(), key = String(ip || "unknown").slice(0, 80);
  if (hits.size > 400) for (const [k,v] of hits) if (v.expires < now) hits.delete(k);
  const state = hits.get(key);
  if (!state || state.expires < now) { hits.set(key,{count:1,expires:now+60000}); return true; }
  if (state.count >= 45) return false;
  state.count++;
  return true;
}
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return reply(405, { error: "Method not allowed" });
  const query = String(event.queryStringParameters?.q || "").trim().replace(/\s+/g," ");
  if (query.length < 3 || query.length > 100) return reply(400, { error: "Enter 3 to 100 characters" });
  if (!allow(event.headers?.["x-nf-client-connection-ip"] || event.headers?.["x-forwarded-for"] || event.headers?.["client-ip"])) {
    return reply(429, { error: "Too many address requests" });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return reply(503, { error: "Address suggestions not configured" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5200);
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      body: JSON.stringify({
        input: query,
        languageCode: "en",
        includedRegionCodes: ["gb"],
        locationBias: {
          circle: { center: { latitude: 54.60, longitude: -5.70 }, radius: 47000 }
        }
      }),
    });
    if (!response.ok) {
      // Don't log the customer's input or expose credential/billing details.
      console.warn("Places autocomplete failed with status", response.status);
      return reply(502, { error: "Google address suggestions unavailable" });
    }
    const data = await response.json();
    const addresses = (Array.isArray(data.suggestions) ? data.suggestions : [])
      .map((item) => ({
        id: String(item?.placePrediction?.placeId || "").slice(0, 180),
        label: String(item?.placePrediction?.text?.text || "").slice(0, 240),
        source: "google-server",
      }))
      .filter((item) => item.id && item.label)
      .slice(0, 8);
    return reply(200, { addresses });
  } catch (error) {
    console.warn("Places autocomplete temporary failure",error?.name === "AbortError" ? "timeout" : "network");
    return reply(503, { error: "Address suggestions temporarily unavailable" });
  } finally {
    clearTimeout(timeout);
  }
};
