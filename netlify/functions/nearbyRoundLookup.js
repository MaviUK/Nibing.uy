import { gunzipSync } from "node:zlib";

const SCHEDULE_CELLS_GZIP_BASE64 = "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";
const SCHEDULE_CELLS = JSON.parse(gunzipSync(Buffer.from(SCHEDULE_CELLS_GZIP_BASE64, "base64")).toString("utf8"));

const EARTH_RADIUS_M = 6371000;
function toRad(value) { return value * Math.PI / 180; }
function distanceMeters(aLat, aLon, bLat, bLon) {
  const dLat = toRad(bLat - aLat); const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
function normalizePostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}
function normalizeBin(value) {
  const s = String(value || "").toUpperCase();
  if (s.includes("BLACK") || s.includes("GREY") || s.includes("GRAY")) return "BLACK";
  if (s.includes("BLUE")) return "BLUE";
  if (s.includes("BROWN") || s.includes("GREEN")) return "BROWN";
  return s.trim();
}
async function geocodePostcode(postcode) {
  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ""))}`);
  const data = await res.json().catch(() => ({}));
  const lat = Number(data?.result?.latitude); const lon = Number(data?.result?.longitude);
  return res.ok && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, source: "postcode" } : null;
}
async function geocodeAddress(address, postcode) {
  const q = [address, postcode, "Northern Ireland", "UK"].filter(Boolean).join(", ");
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": "NI-Bin-Guy-booking/1.0 (https://nibing.uy)" } });
  const data = await res.json().catch(() => []);
  const lat = Number(data?.[0]?.lat); const lon = Number(data?.[0]?.lon);
  return res.ok && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, source: "property_address" } : null;
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const postcode = normalizePostcode(url.searchParams.get("postcode"));
    const address = String(url.searchParams.get("address") || "").trim();
    const bin = normalizeBin(url.searchParams.get("bin"));
    if (!postcode || !bin) return new Response(JSON.stringify({ error: "postcode and bin are required" }), { status: 400, headers: { "Content-Type": "application/json" } });

    let target = address ? await geocodeAddress(address, postcode) : null;
    if (!target) target = await geocodePostcode(postcode);
    if (!target) return new Response(JSON.stringify({ matched: false, reason: "property_geocode_failed", postcode, bin }), { headers: { "Content-Type": "application/json" } });

    const nearby = SCHEDULE_CELLS
      .filter(([, , service]) => String(service).toUpperCase() === bin)
      .map(([lat, lon, service, round, nextVisit, support]) => ({
        round,
        anchorDate: nextVisit,
        nextCleanDate: nextVisit,
        support,
        distanceMeters: Math.round(distanceMeters(target.lat, target.lon, lat, lon))
      }))
      .filter((item) => item.distanceMeters <= 2200)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    const grouped = new Map();
    for (const item of nearby) {
      const key = `${item.round}|${item.anchorDate}`;
      const current = grouped.get(key) || { round: item.round, anchorDate: item.anchorDate, nextCleanDate: item.nextCleanDate, nearestDistanceMeters: item.distanceMeters, support: 0, weightedSupport: 0 };
      current.nearestDistanceMeters = Math.min(current.nearestDistanceMeters, item.distanceMeters);
      current.support += item.support;
      current.weightedSupport += item.support / Math.max(100, item.distanceMeters);
      grouped.set(key, current);
    }

    const candidates = [...grouped.values()]
      .sort((a, b) => (a.nearestDistanceMeters - b.nearestDistanceMeters) || (b.weightedSupport - a.weightedSupport))
      .slice(0, 12);

    return new Response(JSON.stringify({ matched: candidates.length > 0, method: target.source === "property_address" ? "customer_schedule_proximity" : "postcode_schedule_proximity", locationSource: target.source, postcode, bin, candidates }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Nearby round lookup failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

export const config = { path: "/api/nearby-round-lookup" };
