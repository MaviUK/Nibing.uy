import config from "./data/activeServiceAreas.json";

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
