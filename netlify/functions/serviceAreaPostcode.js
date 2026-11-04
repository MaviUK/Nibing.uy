import {classifyCouncilAddresses} from "../../src/serviceAreaPolicy.mjs";
// Approximate zone screening only. Actual coverage requires matching the
// council's own address locality against the active round-town list.
const COVERED_TOWNS = [
  { name: "Bangor", lat: 54.6608, lon: -5.6680, radiusKm: 7.0 },
  { name: "Holywood", lat: 54.6408, lon: -5.8344, radiusKm: 4.0 },
  { name: "Newtownards", lat: 54.5924, lon: -5.6909, radiusKm: 6.5 },
  { name: "Donaghadee", lat: 54.6414, lon: -5.5354, radiusKm: 5.0 },
  { name: "Carrowdore", lat: 54.575347, lon: -5.556056, radiusKm: 3.0 },
  { name: "Comber", lat: 54.5494, lon: -5.7441, radiusKm: 5.0 },
;

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
  const json=(body,status=200,cache=false)=>new Response(JSON.stringify(body),{
    status,headers:{"Content-Type":"application/json",
      "Cache-Control":cache?"public, max-age=0, must-revalidate":"no-store",
      ...(cache?{"Netlify-CDN-Cache-Control":"public, durable, max-age=600"}:{})},
  });
  const postcode=normalisePostcode(new URL(req.url).searchParams.get("postcode"));
  if(!/^BT\d{1,2}[A-Z\d]?\d[A-Z]{2}$/.test(postcode))
    return json({valid:false,covered:false,reason:"invalid_postcode"},400);
  try{
    // In parallel: short geographical sanity check and the council's real
    // postcode-specific addresses (the latter is already cached by Netlify).
    const [geoResult,addressResult]=await Promise.allSettled([
      fetch("https://api.postcodes.io/postcodes/"+encodeURIComponent(postcode),
        {headers:{"User-Agent":"nibing-service-area/2.0"},signal:AbortSignal.timeout(7500)}),
      fetch(new URL("/.netlify/functions/binAddresses?postcode="+
        encodeURIComponent(postcode),req.url),{signal:AbortSignal.timeout(7500)}),
    ]);
    const geo=geoResult.status==="fulfilled"?geoResult.value:null;
    if(!geo?.ok) return json({valid:geo?.status!==404,covered:false,
      possible:false,reason:geo?.status===404?"postcode_not_found":"postcode_lookup_unavailable"},
      geo?.status===404?404:502);
    const payload=await geo.json();
    const raw=payload?.result||{};
    const lat=Number(raw.latitude),lon=Number(raw.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))
      return json({valid:true,covered:false,possible:true,
        reason:"postcode_location_requires_review",postcode});
    const nearest=COVERED_TOWNS.map(town=>({
      ...town,distanceKm:distanceKm(lat,lon,town.lat,town.lon),
    })).sort((a,b)=>a.distanceKm-b.distanceKm)[0];
    const near=Boolean(nearest && nearest.distanceKm<=nearest.radiusKm);
    let classifications=null;
    if(addressResult.status==="fulfilled"&&addressResult.value.ok){
      const data=await addressResult.value.json().catch(()=>null);
      classifications=classifyCouncilAddresses(data?.data?.addresses||data?.addresses||[]);
    }
    const rows=classifications?.addresses||[];
    const active=classifications?.active||[];
    const nonactive=rows.length-active.length;
    const possible=near && (!rows.length||active.length>0||
      (classifications?.review?.length||0)>0);
    const confirmed=near&&active.length>0&&nonactive===0;
    const reason=!near?"outside_current_round_zone":
      !rows.length?"council_address_lookup_unavailable":
      confirmed?"council_town_verified":
      active.length?"select_address_for_confirmation":
      classifications?.review?.length?"service_town_requires_review":
      "outside_current_service_towns";
    // These are public council addresses already returned by binAddresses.
    // Return them once to avoid immediately repeating the lookup in React.
    return json({valid:true,covered:confirmed,possible,reason,
      postcode:raw.postcode||postcode,
      town:active[0]?.town||"",
      nearestTown:nearest?.name||"",distanceKm:nearest?
        Math.round(nearest.distanceKm*100)/100:null,
      requiresAddressSelection:true,
      addresses:rows.map(({uprn,label,town,status})=>({uprn,label,town,status}))},
      200,Boolean(classifications));
  }catch(error){
    console.warn("Preview postcode coverage lookup unavailable",
      error?.name||"unknown");
    return json({valid:false,covered:false,possible:false,
      reason:"lookup_failed"},502);
  }
}
