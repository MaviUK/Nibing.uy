/*
 * Fetch the full address (including its actual BT postcode) for a selected
 * Google Places autocomplete prediction. No address is inferred or stored.
 * This function uses the protected Places API key, not a browser-restricted key.
 */
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const respond = (statusCode, value) => ({ statusCode, headers: HEADERS, body: JSON.stringify(value) });
const counters = new Map();

function isAllowed(ip) {
  const now = Date.now();
  const identifier = String(ip || "unknown").split(",")[0].trim().slice(0, 100);
  for (const [key, item] of counters) if (item.expires <= now) counters.delete(key);
  const item = counters.get(identifier);
  if (!item) { counters.set(identifier, { expires: now + 60000, count: 1 }); return true; }
  if (item.count >= 45) return false;
  item.count += 1;
  return true;
}

function extractBtPostcode(value) {
  const match = String(value || "").toUpperCase().match(/\bBT\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/);
  if (!match) return "";
  const compact = match[0].replace(/\s+/g, "");
  return compact.slice(0, -3) + " " + compact.slice(-3);
}

function fullAddress(formatted, postcode) {
  const original = String(formatted || "").trim().replace(/\s+/g, " ");
  if (!postcode || extractBtPostcode(original)) return original;
  const withoutCountry = original.replace(/,\s*(?:UK|United Kingdom)\s*$/i, "").replace(/,\s*$/, "");
  return withoutCountry + ", " + postcode + (withoutCountry !== original ? ", UK" : "");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return respond(405, { error: "Method not allowed" });
  const placeId = String(event.queryStringParameters?.placeId || "").trim();
  if (!/^[A-Za-z0-9_-]{5,300}$/.test(placeId)) {
    return respond(400, { error: "Invalid Google place reference" });
  }
  if (!isAllowed(event.headers?.["x-nf-client-connection-ip"] || event.headers?.["x-forwarded-for"] || event.headers?.["client-ip"])) {
    return respond(429, { error: "Too many address lookups" });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return respond(503, { error: "Google address details unavailable" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5400);
  try {
    const response = await fetch(
      "https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId) +
        "?languageCode=en&regionCode=gb",
      {
        signal: controller.signal,
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "id,formattedAddress,addressComponents,postalAddress,location",
        },
      }
    );
    if (!response.ok) {
      // Never log or expose the customer's address or the Google API key.
      console.warn("Google place details lookup failed:", response.status);
      return respond(502, { error: "Google could not confirm the postcode" });
    }
    const data = await response.json();
    const components = Array.isArray(data.addressComponents) ? data.addressComponents : [];
    const postComponent = components.find((component) => component.types?.includes("postal_code"));
    const postcode = extractBtPostcode(
      postComponent?.longText || postComponent?.shortText ||
      data.postalAddress?.postalCode || data.formattedAddress
    ) || extractBtPostcode(data.formattedAddress);
    const formattedAddress = fullAddress(data.formattedAddress, postcode);
    const latitude = Number(data.location?.latitude);
    const longitude = Number(data.location?.longitude);

    return respond(200, {
      place_id: String(data.id || placeId),
      formatted_address: formattedAddress,
      postcode,
      postcode_required: !postcode,
      location: Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { latitude, longitude }
        : null,
    });
  } catch (error) {
    console.warn("Google place details failed:", error?.name === "AbortError" ? "timeout" : "network");
    return respond(503, { error: "Google address details temporarily unavailable" });
  } finally {
    clearTimeout(timer);
  }
};
