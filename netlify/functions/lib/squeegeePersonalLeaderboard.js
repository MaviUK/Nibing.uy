"use strict";
// An authenticated customer's totals and public rank, computed from exactly
// the same backed-up Squeegee / verified website data as Preview 77's boards.
// Never accept a customer id or score from browser input.
const crypto=require("node:crypto");
const hq=require("./customerHQ");
const historical=require("./squeegeeActiveLeaderboardImport");
const overallPreview=require("./squeegeeActivePreviewBoard");
const annual=require("./squeegeeYearlyPreviewBoard");
const names=require("./squeegeeLeaderboardNameConsent");

function publicRef(alias,secretKey){
  if(!/^NBG-[A-F0-9]{10}$/.test(String(alias||"")) ||
     !Buffer.isBuffer(secretKey) || secretKey.length<16)return null;
  // Must match previewFirstNameScoreboard's keyed public reference.
  return "NBG-"+crypto.createHmac("sha256",secretKey)
    .update("n64-preview-public-first-name-v1:"+alias)
    .digest("hex").slice(0,10).toUpperCase();
}
function visibleRank({privateCustomers,eligibleAliases,consentSnapshot,
                      secretKey,board,customerAlias}){
  if(!board)return null;
  const shown=names.previewFirstNameScoreboard(
    privateCustomers,board,eligibleAliases,consentSnapshot,secretKey
  );
  const ref=publicRef(customerAlias,secretKey);
  const row=shown?.entries?.find(entry=>entry.customerRef===ref);
  return Number.isSafeInteger(row?.rank)&&row.rank>0?row.rank:null;
}
function fromBoards({customerId,privateCustomers,eligibleAliases,
                     consentSnapshot,secretKey,overallBoard,yearlyBoards=[],
                     allowPublicRanks=true}){
  const alias=historical.canonicalLegacyRef(customerId);
  const eligible=Boolean(alias && eligibleAliases instanceof Set &&
    eligibleAliases.has(alias));
  const matched=eligible?overallBoard?.entries?.find(
    entry=>entry.customerRef===alias):null;
  const account=privateCustomers?.accounts?.find(x=>x.id===customerId);
  if(!account)throw new Error("personal_customer_not_in_backup");
  const yearly={};
  let cleanTotal=0,yearlyTotal=0;
  for(const board of yearlyBoards){
    const year=board?.year;
    if(!annual.validVerifiedYear(year))continue;
    const clean=annual.annualCleaningXP(account.events,year,privateCustomers.asOf);
    cleanTotal+=clean;
    const own=board.entries?.find(row=>row.customerRef===alias);
    if(!Number.isSafeInteger(own?.points)||own.points<=0)continue;
    yearly[String(year)]={
      points:own.points,
      rank:allowPublicRanks?visibleRank({privateCustomers,eligibleAliases,
        consentSnapshot,secretKey,board,customerAlias:alias}):null
    };
    yearlyTotal+=own.points;
  }
  if(!Number.isSafeInteger(cleanTotal)||cleanTotal<0)
    throw new Error("invalid_cleaning_score");
  // Only the sum of dated yearly awards may be displayed as Overall.
  // A positive undated legacy balance is intentionally never credited.
  const points=eligible ? (matched?.points||0) : cleanTotal;
  if(!Number.isSafeInteger(points)||points<cleanTotal ||
     (eligible&&points!==yearlyTotal))
    throw new Error("personal_dated_total_mismatch");
  const websiteXp=points-cleanTotal;
  const hasPublicBoard=allowPublicRanks===true &&
    overallBoard?.status!=="active_status_refresh_required";
  return {
    points,cleaningPoints:cleanTotal,websiteXp,
    rank:eligible&&hasPublicBoard?visibleRank({
      privateCustomers,eligibleAliases,consentSnapshot,secretKey,
      board:overallBoard,customerAlias:alias
    }):null,
    yearly,rankingAvailable:eligible&&hasPublicBoard,
    yearlyXpTotal:yearlyTotal
  };
}
async function getPersonalSummary({stores,privateCustomers,customerId,
                                   consentSnapshot,secretKey,now=Date.now()}){
  const account=privateCustomers?.accounts?.find(x=>x.id===customerId);
  if(!account)throw new Error("personal_customer_not_in_backup");
  const eligible=hq.eligibleRankedEmailAccounts(privateCustomers);
  const alias=historical.canonicalLegacyRef(customerId);
  if(!eligible || !alias || !eligible.aliases.has(alias) ||
     !Buffer.isBuffer(secretKey)||secretKey.length<16){
    // An authenticated customer outside the public cohort retains only
    // their already dated cleaning points. Unknown website XP is excluded.
    const yearTotals=new Map();
    for(const event of Array.isArray(account.events)?account.events:[]){
      const year=Number(String(event?.date||"").slice(0,4));
      const points=annual.annualCleaningXP([event],year,privateCustomers.asOf);
      if(!annual.validVerifiedYear(year,now)||!points)continue;
      yearTotals.set(year,(yearTotals.get(year)||0)+points);
    }
    const yearly={};
    let points=0;
    for(const [year,xp] of yearTotals){yearly[String(year)]={points:xp,rank:null};points+=xp;}
    return {points,cleaningPoints:points,websiteXp:0,rank:null,yearly,
      yearlyXpTotal:points,rankingAvailable:false};
  }
  const [mode,published]=await Promise.all([
    stores.history.get(historical.MODE_KEY,{type:"json",consistency:"strong"}),
    stores.history.get(historical.PUBLISHED_KEY,{type:"json",consistency:"strong"})
  ]);
  const allowPublicRanks=mode?.activeOnly!==true || Boolean(published);
  const {overallBoard,yearlyBoards}=await annual.getDatedScoreBoards(
    stores,privateCustomers,eligible.aliases,now);
  return fromBoards({customerId,privateCustomers,
    eligibleAliases:eligible.aliases,consentSnapshot,secretKey,
    overallBoard,yearlyBoards,allowPublicRanks});
}
module.exports={publicRef,visibleRank,fromBoards,getPersonalSummary};
