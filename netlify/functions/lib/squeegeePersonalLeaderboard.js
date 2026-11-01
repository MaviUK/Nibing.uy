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
function fromBoards({customerId,points,privateCustomers,eligibleAliases,
                     consentSnapshot,secretKey,overallBoard,yearlyBoards=[],
                     allowPublicRanks=true}){
  if(!Number.isSafeInteger(points)||points<0)throw new Error("invalid_personal_points");
  const result={points,rank:null,yearly:{},
    rankingAvailable:allowPublicRanks===true};
  const alias=historical.canonicalLegacyRef(customerId);
  if(!alias || !(eligibleAliases instanceof Set) || !eligibleAliases.has(alias))
    return {...result,rankingAvailable:false};
  if(allowPublicRanks && overallBoard){
    result.rank=visibleRank({privateCustomers,eligibleAliases,consentSnapshot,
      secretKey,board:overallBoard,customerAlias:alias});
    // Do not falsely label a missing public board as a withdrawal.
    if(overallBoard.status==="active_status_refresh_required")
      result.rankingAvailable=false;
  }else if(allowPublicRanks)result.rankingAvailable=false;
  for(const board of yearlyBoards){
    const year=board?.year;
    if(!Number.isSafeInteger(year) || year<annual.FIRST_YEAR)continue;
    const own=board?.entries?.find(row=>row.customerRef===alias);
    if(!Number.isSafeInteger(own?.points)||own.points<=0)continue;
    result.yearly[String(year)]={
      points:own.points,
      rank:allowPublicRanks?visibleRank({privateCustomers,eligibleAliases,
        consentSnapshot,secretKey,board,customerAlias:alias}):null
    };
  }
  return result;
}
async function getPersonalSummary({stores,privateCustomers,customerId,points,
                                   consentSnapshot,secretKey,now=Date.now()}){
  if(!Number.isSafeInteger(points)||points<0)
    throw new Error("invalid_personal_points");
  const empty={points,rank:null,yearly:{},rankingAvailable:false};
  const eligible=hq.eligibleRankedEmailAccounts(privateCustomers);
  const alias=historical.canonicalLegacyRef(customerId);
  if(!eligible || !alias || !eligible.aliases.has(alias) ||
     !Buffer.isBuffer(secretKey) || secretKey.length<16)return empty;

  // When the owner hides a published board, private XP remains visible but
  // no ranking is inferred or re-published through this authenticated route.
  const [mode,published]=await Promise.all([
    stores.history.get(historical.MODE_KEY,{type:"json",consistency:"strong"}),
    stores.history.get(historical.PUBLISHED_KEY,{type:"json",consistency:"strong"})
  ]);
  const allowPublicRanks=mode?.activeOnly!==true || Boolean(published);
  const [overallBoard,datedWeb]=await Promise.all([
    allowPublicRanks?overallPreview.getStaticPreviewBoard(stores,now,true):null,
    annual.datedWebsiteXP(stores,eligible.aliases,now)
  ]);
  // Re-use ONE verified website ledger scan for all years, instead of three
  // expensive duplicate reads. Exactly mirrors public annual board sorting.
  const yearlyBoards=[];
  for(const year of annual.availableYears(now)){
    yearlyBoards.push(await annual.getAnnualPreviewBoard(
      stores,privateCustomers,eligible.aliases,year,now,datedWeb
    ));
  }
  return fromBoards({customerId,points,privateCustomers,
    eligibleAliases:eligible.aliases,consentSnapshot,secretKey,
    overallBoard,yearlyBoards,allowPublicRanks});
}
module.exports={publicRef,visibleRank,fromBoards,getPersonalSummary};
