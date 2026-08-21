const CLUSTERS = [[54.5545,-5.7352,"Black",1,"2026-08-24",31],[54.6364,-5.6646,"Black",1,"2026-08-24",7],[54.6476,-5.696,"Black",1,"2026-08-24",5],[54.6577,-5.634,"Black",1,"2026-08-24",8],[54.592,-5.6947,"Black",1,"2026-08-24",8],[54.5928,-5.6761,"Black",2,"2026-08-25",21],[54.646,-5.6364,"Black",2,"2026-08-25",11],[54.6496,-5.6948,"Black",2,"2026-08-25",14],[54.5988,-5.6666,"Black",2,"2026-08-25",15],[54.5893,-5.711,"Black",2,"2026-08-25",5],[54.5494,-5.7554,"Black",3,"2026-08-26",39],[54.6502,-5.6846,"Black",3,"2026-08-26",9],[54.5981,-5.6975,"Black",3,"2026-08-26",7],[54.6423,-5.6524,"Black",3,"2026-08-26",17],[54.5934,-5.6663,"Black",3,"2026-08-26",4],[54.6374,-5.6721,"Black",4,"2026-08-27",12],[54.5931,-5.6786,"Black",4,"2026-08-27",17],[54.596,-5.7186,"Black",4,"2026-08-27",2],[54.6455,-5.6577,"Black",4,"2026-08-27",10],[54.3801,-5.5419,"Black",11,"2026-09-07",9],[54.5485,-5.5574,"Black",11,"2026-09-07",4],[54.6075,-5.5352,"Black",12,"2026-09-08",28],[54.5476,-5.4891,"Black",12,"2026-09-08",6],[54.6019,-5.5615,"Black",12,"2026-09-08",2],[54.6393,-5.5467,"Black",13,"2026-09-09",12],[54.6395,-5.5435,"Black",14,"2026-09-10",14],[54.456,-5.4528,"Black",14,"2026-09-10",8],[54.6317,-5.6764,"Black | Brown",1,"2026-08-24",1],[54.6681,-5.6962,"Black | Brown",2,"2026-08-25",1],[54.6469,-5.6685,"Black | Brown",4,"2026-08-27",3],[54.3825,-5.536,"Black | Brown",11,"2026-09-07",1],[54.6379,-5.5459,"Black | Brown",13,"2026-09-09",1],[54.6296,-5.5386,"Black | Brown",14,"2026-09-10",2],[54.5938,-5.7037,"Blue",8,"2026-09-02",2],[54.5865,-5.6892,"Blue",9,"2026-09-03",3],[54.6161,-5.6721,"Blue",16,"2026-09-14",8],[54.6082,-5.5442,"Blue",17,"2026-09-15",4],[54.6301,-5.6733,"Blue",17,"2026-09-15",20],[54.617,-5.6702,"Blue",18,"2026-09-16",7],[54.6497,-5.6653,"Blue",19,"2026-09-17",9],[54.5542,-5.7471,"Blue | Brown",8,"2026-09-02",1],[54.6657,-5.6372,"Blue | Brown",16,"2026-09-14",1],[54.6146,-5.6824,"Blue | Brown",19,"2026-09-17",2],[54.5979,-5.6691,"Brown",1,"2026-08-24",30],[54.6729,-5.6184,"Brown",1,"2026-08-24",3],[54.6497,-5.7015,"Brown",1,"2026-08-24",3],[54.6594,-5.6709,"Brown",2,"2026-08-25",10],[54.6617,-5.6539,"Brown",3,"2026-08-26",7],[54.6008,-5.6566,"Brown",3,"2026-08-26",6],[54.6589,-5.636,"Brown",4,"2026-08-27",4],[54.6456,-5.6829,"Brown",4,"2026-08-27",9],[54.5549,-5.7309,"Brown",8,"2026-09-02",34],[54.6378,-5.6516,"Brown",8,"2026-09-02",5],[54.5898,-5.6982,"Brown",8,"2026-09-02",2],[54.5562,-5.7395,"Brown",8,"2026-09-02",11],[54.5524,-5.7483,"Brown",8,"2026-09-02",8],[54.5498,-5.763,"Brown",9,"2026-09-03",21],[54.5924,-5.6791,"Brown",9,"2026-09-03",8],[54.5475,-5.7493,"Brown",9,"2026-09-03",4],[54.5468,-5.7567,"Brown",9,"2026-09-03",16],[54.6092,-5.6775,"Brown",9,"2026-09-03",1],[54.3819,-5.541,"Brown",11,"2026-09-07",32],[54.4127,-5.5354,"Brown",11,"2026-09-07",1],[54.3562,-5.5293,"Brown",11,"2026-09-07",1],[54.4551,-5.4536,"Brown",12,"2026-09-08",11],[54.6474,-5.5656,"Brown",12,"2026-09-08",13],[54.6354,-5.5375,"Brown",13,"2026-09-09",12],[54.6449,-5.5448,"Brown",13,"2026-09-09",5],[54.6374,-5.5429,"Brown",13,"2026-09-09",16],[54.6057,-5.5342,"Brown",14,"2026-09-10",23],[54.5119,-5.4786,"Brown",14,"2026-09-10",4],[54.5697,-5.5594,"Brown",14,"2026-09-10",5],[54.6344,-5.5365,"Brown",14,"2026-09-10",14],[54.6532,-5.6382,"Brown",16,"2026-09-14",10],[54.5788,-5.7118,"Brown",16,"2026-09-14",10],[54.651,-5.6985,"Brown",16,"2026-09-14",7],[54.6456,-5.6373,"Brown",17,"2026-09-15",16],[54.5902,-5.7123,"Brown",17,"2026-09-15",4],[54.6495,-5.6972,"Brown",17,"2026-09-15",6],[54.5884,-5.6737,"Brown",18,"2026-09-16",35],[54.6454,-5.6874,"Brown",18,"2026-09-16",7],[54.5929,-5.691,"Brown",18,"2026-09-16",13],[54.6518,-5.6739,"Brown",18,"2026-09-16",5],[54.6422,-5.6494,"Brown",18,"2026-09-16",2],[54.5959,-5.6871,"Brown",19,"2026-09-17",23],[54.6471,-5.6585,"Brown",19,"2026-09-17",16],[54.6318,-5.6672,"Brown",19,"2026-09-17",7],[54.6504,-5.6791,"Brown",19,"2026-09-17",2],[54.5996,-5.7001,"Brown",19,"2026-09-17",4],[54.6489,-5.6494,"Brown | Black",1,"2026-08-24",6],[54.6593,-5.6894,"Brown | Black",2,"2026-08-25",15],[54.604,-5.6773,"Brown | Black",2,"2026-08-25",3],[54.6294,-5.6457,"Brown | Black",3,"2026-08-26",8],[54.6591,-5.6362,"Brown | Black",4,"2026-08-27",9],[54.6419,-5.68,"Brown | Black",4,"2026-08-27",16],[54.656,-5.6906,"Brown | Black",4,"2026-08-27",6],[54.6231,-5.5911,"Brown | Black",8,"2026-09-02",1],[54.383,-5.5366,"Brown | Black",11,"2026-09-07",13],[54.3828,-5.5415,"Brown | Black",11,"2026-09-07",8],[54.3796,-5.5463,"Brown | Black",11,"2026-09-07",4],[54.5233,-5.5891,"Brown | Black",12,"2026-09-08",2],[54.6386,-5.5431,"Brown | Black",13,"2026-09-09",18],[54.6631,-5.5662,"Brown | Black",13,"2026-09-09",3],[54.6285,-5.5399,"Brown | Black",14,"2026-09-10",20],[54.4422,-5.4697,"Brown | Black",14,"2026-09-10",1],[54.6339,-5.537,"Brown | Black",14,"2026-09-10",5],[54.5829,-5.6992,"Brown | Black",16,"2026-09-14",1],[54.5804,-5.7133,"Brown | Blue",8,"2026-09-02",3],[54.5498,-5.7495,"Brown | Blue",9,"2026-09-03",1],[54.6465,-5.6686,"Brown | Blue",16,"2026-09-14",13],[54.5787,-5.7062,"Brown | Blue",16,"2026-09-14",3],[54.6408,-5.6926,"Brown | Blue",17,"2026-09-15",8],[54.6385,-5.667,"Brown | Blue",18,"2026-09-16",12],[54.6401,-5.6639,"Brown | Blue",19,"2026-09-17",12],[54.6674,-5.6376,"Brown | Green",16,"2026-09-14",1],[54.6613,-5.6519,"Green",3,"2026-08-26",1],[54.6571,-5.6338,"Green",17,"2026-09-15",2],[54.6508,-5.6614,"Green",19,"2026-09-17",2]];

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
function serviceMatches(service, bin) {
  const s = String(service || "").toUpperCase();
  return bin === "BLACK" ? s.includes("BLACK") : bin === "BLUE" ? s.includes("BLUE") : s.includes("BROWN") || s.includes("GREEN");
}
async function geocodePostcode(postcode) {
  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ""))}`);
  const data = await res.json().catch(() => ({}));
  const lat = Number(data?.result?.latitude); const lon = Number(data?.result?.longitude);
  return res.ok && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, source: "postcode" } : null;
}
async function geocodeAddress(address, postcode) {
  const q = [address, postcode, "Northern Ireland", "UK"].filter(Boolean).join(", ");
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "NI-Bin-Guy-booking/1.0 (https://nibing.uy)" }
  });
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

    const nearby = CLUSTERS
      .filter(([, , service]) => serviceMatches(service, bin))
      .map(([lat, lon, service, round, anchorDate, support]) => ({ round, anchorDate, support, distanceMeters: Math.round(distanceMeters(target.lat, target.lon, lat, lon)) }))
      .filter((item) => item.distanceMeters <= 2200)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    const grouped = new Map();
    for (const item of nearby) {
      const key = `${item.round}|${item.anchorDate}`;
      const current = grouped.get(key) || { round: item.round, anchorDate: item.anchorDate, nearestDistanceMeters: item.distanceMeters, support: 0, weightedSupport: 0 };
      current.nearestDistanceMeters = Math.min(current.nearestDistanceMeters, item.distanceMeters);
      current.support += item.support;
      current.weightedSupport += item.support / Math.max(100, item.distanceMeters);
      grouped.set(key, current);
    }

    const candidates = [...grouped.values()]
      .sort((a, b) => (a.nearestDistanceMeters - b.nearestDistanceMeters) || (b.weightedSupport - a.weightedSupport))
      .slice(0, 8);

    return new Response(JSON.stringify({ matched: candidates.length > 0, method: target.source === "property_address" ? "property_proximity_candidates" : "postcode_proximity_candidates", locationSource: target.source, postcode, bin, candidates }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Nearby round lookup failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

export const config = { path: "/api/nearby-round-lookup" };