"use strict";
const staticHistory=require("./squeegeeActivePreviewSnapshot");
const active=require("./squeegeeActiveLeaderboardImport");

// Dated, pseudonymous 31 Oct 2026 Squeegee customer snapshot. This code is
// deployed on N64 PREVIEW 1 only and is selected only by the exact preview
// hostname. No sensitive Squeegee UUID, actual customer ref or contact
// data exists in the compiled snapshot.
//
// Verified website XP may be added only after the Squeegee booking worker
// confirms the same immutable customer UUID and writes a private link.
// A second website player using that same Squeegee UUID causes ALL linked
// website XP for that UUID to be held, never duplicated.
async function getStaticPreviewBoard(stores, now=Date.now()) {
  const base=staticHistory.getHistoricalSnapshot(now);
  if(base.status==="active_status_refresh_required")return base;
  const refs=new Set(staticHistory.ENTRIES.map(([ref])=>ref));
  const scores=new Map(), collisions=new Set();
  let list;
  try {list=await stores.links.list({prefix:"player:"});}
  catch {list={blobs:[]};} // Never erase historical paid-clean scores for a link-read outage.
  const links=Array.isArray(list?.blobs)?list.blobs:[];
  if(links.length>5000)throw new Error("Too many historical player links");
  for(const {key} of links){
    if(!/^player:[a-f0-9]{64}$/.test(String(key||"")))continue;
    try{
      const link=await stores.links.get(key,{type:"json"});
      if(link?.verified!==true)continue;
      const customerRef=active.canonicalLegacyRef(link.squeegeeId);
      if(!refs.has(customerRef))continue;
      if(scores.has(customerRef)){collisions.add(customerRef);continue;}
      const websitePlayer=await stores.public.get(key,{type:"json"});
      const xp=Number(websitePlayer?.points);
      if(!Number.isSafeInteger(xp)||xp<0||xp>100000)continue;
      scores.set(customerRef,xp);
    }catch { /* An unverified or unreadable link contributes no XP. */ }
  }
  for(const ref of collisions)scores.delete(ref);
  const entries=staticHistory.ENTRIES.map(([customerRef,town,historicalStreakPoints])=>({
    customerRef,town,points:Math.min(100000,historicalStreakPoints+(scores.get(customerRef)||0))
  }));
  entries.sort((a,b)=>b.points-a.points||a.customerRef.localeCompare(b.customerRef));
  return {
    entries:entries.slice(0,10).map((e,i)=>({rank:i+1,...e})),
    totalPlayers:entries.length,
    sourceAsOf:staticHistory.AS_OF,lastUpdatedAt:staticHistory.AS_OF+"T23:59:59Z",
    status:"squeegee_active_only",
  };
}
module.exports={getStaticPreviewBoard};
