import config from "./data/activeServiceAreas.json" with { type: "json" };

export const ACTIVE_TOWNS = new Set(config.activeTowns.map(x=>x.toUpperCase()));
export const REMOVED_TOWNS = new Set(config.removedTowns.map(x=>x.toUpperCase()));
export const REVIEW_TOWNS = new Set(config.reviewTowns.map(x=>x.toUpperCase()));
const ALL_TOWNS = new Set([...ACTIVE_TOWNS,...REMOVED_TOWNS,...REVIEW_TOWNS]);

export function normaliseAreaTown(value) {
  return String(value||"").toUpperCase()
    .replace(/\bBT\d{1,2}[A-Z0-9]?\s*\d[A-Z]{2}\b/gi," ")
    .replace(/\b(?:NORTHERN IRELAND|UNITED KINGDOM|COUNTY DOWN|CO DOWN|UK)\b/gi," ")
    .replace(/[.'’]/g,"").replace(/\s+/g," ").trim();
}

// Council address labels carry the ACTUAL town after the street. Never
// mistake "Bangor Road, Comber" for a Bangor service address.
export function townFromAddress(value) {
  const pieces=String(value||"").split(",").slice(1);
  for (const piece of pieces) {
    const town=normaliseAreaTown(piece);
    if(ALL_TOWNS.has(town)) return town;
  }
  return "";
}
export function areaStatusForTown(town) {
  const exact=normaliseAreaTown(town);
  if(ACTIVE_TOWNS.has(exact))return "active";
  if(REMOVED_TOWNS.has(exact))return "removed";
  return "review";
}
export function classifyCouncilAddresses(addresses) {
  const results=(Array.isArray(addresses)?addresses:[]).map(row=>{
    const label=String(row?.addressText||row?.address||row?.label||"").trim();
    const town=townFromAddress(label);
    return {uprn:String(row?.uprn||row?.UPRN||"").trim(),
      label,town,status:areaStatusForTown(town)};
  }).filter(row=>row.uprn&&row.label);
  return {
    addresses:results,
    active:results.filter(x=>x.status==="active"),
    removed:results.filter(x=>x.status==="removed"),
    review:results.filter(x=>x.status==="review"),
  };
}

// Numbered homes match by house number and full postcode, irrespective of
// street spelling. A named property without a number requires an exact name.
export function propertyNumber(value) {
  return String(value||"").trim().toUpperCase()
    .match(/^(\d{1,6}[A-Z]?)(?=\s|,|$)/)?.[1]||"";
}
export function propertyPostcode(value) {
  const found=String(value||"").toUpperCase()
    .match(/\bBT\d{1,2}[A-Z0-9]?\s*\d[A-Z]{2}\b/);
  return found?found[0].replace(/\s+/g,""):"";
}
export function matchesCouncilProperty(entered,councilLabel) {
  const postcode=propertyPostcode(entered);
  if(!postcode || postcode!==propertyPostcode(councilLabel))return false;
  const number=propertyNumber(entered);
  if(number)return number===propertyNumber(councilLabel);
  if(propertyNumber(councilLabel))return false;
  const name=x=>String(x||"").split(",")[0].toUpperCase()
    .replace(/[^A-Z0-9]+/g," ").trim();
  return Boolean(name(entered)&&name(entered)===name(councilLabel));
}
