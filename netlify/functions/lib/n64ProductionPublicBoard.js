"use strict";
const crypto=require("node:crypto");
const consent=require("./squeegeeLeaderboardNameConsent");
const ids=require("./squeegeeActiveLeaderboardImport");
function publicSecret(env){
 const raw=env?.N64_PRODUCTION_PUBLIC_LEADERBOARD_SECRET;
 if(typeof raw!=="string"||raw.length<32)return null;
 return crypto.createHmac("sha256",raw).update("production:public-ranking-v1").digest();
}
function approvedBoard(privateData,scores,eligible,ledger,key){
 const raw=consent.previewFirstNameScoreboard(privateData,scores,eligible,ledger,key);
 if(!raw||raw.status!=="preview_public_first_names"||
    ledger?.sourceAsOf!==privateData?.asOf)return null;
 const records=new Map(ledger.records.map(r=>[r.alias,r]));
 const allowed=new Set();
 for(const account of privateData.accounts){
  const alias=ids.canonicalLegacyRef(account.id),r=records.get(alias);
  if(!eligible.has(alias)||!r||r.ref!==account.ref||r.town!==account.town||
     r.firstName!==account.firstName||r.consent!=="granted"||
     r.withdrawnAt||r.noticeVersion!==consent.NOTICE_VERSION||
     !r.consentAt||!r.evidenceRef||!consent.safeFirstName(r.firstName))continue;
  allowed.add("NBG-"+crypto.createHmac("sha256",key)
   .update("n64-preview-public-first-name-v1:"+alias).digest("hex").slice(0,10).toUpperCase());
 }
 const entries=raw.entries.filter(e=>allowed.has(e.customerRef))
   .map((e,i)=>({...e,rank:i+1}));
 return {entries,totalPlayers:entries.length,approvedCount:entries.length,
  sourceAsOf:raw.sourceAsOf,lastUpdatedAt:raw.lastUpdatedAt,status:"public_eligible_scores"};
}
module.exports={publicSecret,approvedBoard};