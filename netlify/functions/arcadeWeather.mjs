// NI Bin Guy / Preview 1 only: read-only, fixed-location weather for the N64 sky.
// Data: MET Norway Locationforecast 2.0, CC BY 4.0. Commercial use permitted.
const URL_MET = "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=54.6608&lon=-5.6680";
const FRESH = 12 * 60 * 1000;
let lastGood = null, lastFetched = 0;

export function arcadeWeatherMode(symbol, cloudCover = 0) {
  const s = String(symbol || "").toLowerCase();
  if (s.includes("thunder")) return "storm";
  if (s.includes("snow") || s.includes("sleet")) return "snow";
  if (s.includes("rain")) return "rain";
  if (s.includes("fog")) return "fog";
  if (s.includes("cloudy")) return "cloudy";
  if (s.startsWith("fair") || s.includes("clearsky")) return "sunny";
  return Number(cloudCover) >= 55 ? "cloudy" : "sunny";
}

export function isBangorDay(at = new Date()) {
  const t = new Date(at), rad = Math.PI / 180;
  if (!Number.isFinite(t.getTime())) return true;
  const y = t.getUTCFullYear();
  const day = (Date.UTC(y, t.getUTCMonth(), t.getUTCDate()) - Date.UTC(y, 0, 0)) / 86400000;
  const decl = 23.44 * rad * Math.sin(2 * Math.PI * (day - 80) / 365);
  const b = 2 * Math.PI * (day - 81) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const solarTime = t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600
    - 5.6680 / 15 + eot / 60;
  const ha = (solarTime - 12) * 15 * rad, lat = 54.6608 * rad;
  return Math.asin(Math.sin(lat) * Math.sin(decl) +
    Math.cos(lat) * Math.cos(decl) * Math.cos(ha)) > -0.833 * rad;
}

export function parseBangorForecast(payload, at = new Date()) {
  const series = payload?.properties?.timeseries;
  if (!Array.isArray(series) || series.length < 1) throw Error("Missing MET forecast");
  const now = +new Date(at);
  let current = series[0];
  for (const entry of series) {
    const time = Date.parse(entry?.time || "");
    if (!Number.isFinite(time)) continue;
    if (time > now) break;
    current = entry;
  }
  const data = current?.data || {};
  const symbol = data.next_1_hours?.summary?.symbol_code ||
    data.next_6_hours?.summary?.symbol_code ||
    data.next_12_hours?.summary?.symbol_code || "";
  const instant = data.instant?.details || {};
  const rawTemp = instant.air_temperature;
  const temperatureC = Number.isFinite(Number(rawTemp)) && rawTemp != null
    ? Math.round(Number(rawTemp)) : null;
  return {
    mode: arcadeWeatherMode(symbol, instant.cloud_area_fraction),
    isNight: symbol.endsWith("_night") ? true :
      symbol.endsWith("_day") ? false : !isBangorDay(at),
    temperatureC,
    location: "Bangor & North Down",
    updatedAt: payload?.properties?.meta?.updated_at || null,
    forecastTime: current.time || null,
    source: "MET Norway",
    derived: true
  };
}

function respond(data, status = 200, cacheable = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": cacheable ? "public, max-age=600, stale-while-revalidate=600" : "no-store",
      "Netlify-CDN-Cache-Control": cacheable ? "public, s-maxage=600, stale-while-revalidate=600" : "no-store"
    }
  });
}

export default async function handler(req) {
  if (req.method !== "GET") {
    const response = respond({ error: "method_not_allowed" }, 405);
    response.headers.set("Allow", "GET");
    return response;
  }
  const age = Date.now() - lastFetched;
  if (lastGood && age < FRESH) return respond(lastGood, 200, true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const upstream = await fetch(URL_MET, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "NI-Bin-Guy-Weather/1.0 (https://nibing.uy; info@nibing.uy)"
      }
    });
    if (!upstream.ok) throw Error("MET HTTP " + upstream.status);
    lastGood = parseBangorForecast(await upstream.json());
    lastFetched = Date.now();
    return respond(lastGood, 200, true);
  } catch {
    if (lastGood && age < 2 * 60 * 60 * 1000) return respond({ ...lastGood, stale: true });
    return respond({ error: "weather_unavailable" }, 503);
  } finally {
    clearTimeout(timeout);
  }
}
