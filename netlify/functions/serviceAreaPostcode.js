const COVERED_TOWNS = [
  { name: "Bangor", lat: 54.6608, lon: -5.6680, radiusKm: 7.0 },
  { name: "Newtownards", lat: 54.5924, lon: -5.6909, radiusKm: 6.5 },
  { name: "Donaghadee", lat: 54.6414, lon: -5.5354, radiusKm: 5.0 },
  { name: "Comber", lat: 54.5494, lon: -5.7441, radiusKm: 5.0 },
  { name: "Millisle", lat: 54.6079, lon: -5.5299, radiusKm: 4.5 },
  { name: "Ballywalter", lat: 54.5432, lon: -5.4841, radiusKm: 4.5 },
  { name: "Portaferry", lat: 54.3812, lon: -5.5455, radiusKm: 5.0 },
  { name: "Portavogie", lat: 54.4607, lon: -5.4426, radiusKm: 4.5 },
  { name: "Cloughey", lat: 54.4314, lon: -5.5450, radiusKm: 4.5 },
  { name: "Ballyhalbert", lat: 54.5037, lon: -5.4849, radiusKm: 4.5 },
];

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalisePostcode(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").trim();
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const postcode = normalisePostcode(url.searchParams.get("postcode"));

    if (!/^BT\d{1,2}[A-Z\d]?\d[A-Z]{2}$/.test(postcode)) {
      return new Response(JSON.stringify({ valid: false, covered: false, reason: "invalid_postcode" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const upstream = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      headers: { "User-Agent": "nibing-service-area/1.0" },
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ valid: false, covered: false, reason: "postcode_not_found" }), {
        status: upstream.status === 404 ? 404 : 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const payload = await upstream.json();
    const result = payload?.result;
    const latitude = Number(result?.latitude);
    const longitude = Number(result?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return new Response(JSON.stringify({ valid: true, covered: false, reason: "location_unavailable" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
      });
    }

    const ranked = COVERED_TOWNS
      .map((town) => ({ ...town, distanceKm: distanceKm(latitude, longitude, town.lat, town.lon) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const nearest = ranked[0];
    const covered = Boolean(nearest && nearest.distanceKm <= nearest.radiusKm);

    return new Response(
      JSON.stringify({
        valid: true,
        covered,
        town: covered ? nearest.name : "",
        nearestTown: nearest?.name || "",
        distanceKm: nearest ? Number(nearest.distanceKm.toFixed(2)) : null,
        adminDistrict: result?.admin_district || "",
        postcode: result?.postcode || postcode,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ valid: false, covered: false, reason: "lookup_failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
