"use strict";
// Preview 77 records: use ONLY identities and annual XP already displayed
// on the exact same public leaderboard. No new consent or permission is granted.
// All private refs, job details, email addresses and UUIDs stay server-side.
const crypto=require("node:crypto");
const history=require("./squeegeeActiveLeaderboardImport");
const awards=require("./squeegeePreviewOwnerAchievements");
const names=require("./squeegeeLeaderboardNameConsent");
const {safePublicTown}=require("./arcadePublicIdentity");
const FIRST_YEAR=2024;
const PUBLIC_REF=/^NBG-[A-F0-9]{10}$/;

function highlights(snapshot,eligibleAliases,permissions,period="overall",publicScores,secretKey){
 if(snapshot?.version!==1||!Array.isArray(snapshot.accounts)||
   typeof snapshot.asOf!=="string"||
   !(eligibleAliases instanceof Set)||
   permissions?.version!==1||
   permissions.sourceAsOf!==snapshot.asOf||
   !Array.isArray(permissions.records)||
   publicScores?.status!=="preview_public_first_names"||
   publicScores?.sourceAsOf!==snapshot.asOf||
   !Array.isArray(publicScores.entries)||
   !Buffer.isBuffer(secretKey)||secretKey.length<16)return null;
 const lastYear=Number(snapshot.asOf.slice(0,4));
 const year=period==="overall"?null:Number(period);
 if(year!==null&&(!/^20\d{2}$/.test(String(period))||
   !Number.isSafeInteger(year)||year<FIRST_YEAR||year>lastYear))return null;

 // This is the SAME displayed scoreboard returned by previewFirstNameScoreboard.
 // A record can only be named if its customer is already visible there.
 const published=new Map();
 for(const row of publicScores.entries){
   if(!PUBLIC_REF.test(String(row?.customerRef||""))||
     !names.safeFirstName(row.displayName)||
     safePublicTown(row.town)!==row.town||row.town==="Town unavailable"||
     !Number.isSafeInteger(row.points)||row.points<0||row.points>100000||
     published.has(row.customerRef))return null;
   published.set(row.customerRef,{
     displayName:row.displayName,town:row.town,points:row.points
   });
 }
 if(!published.size)return null;

 // Re-evaluate the CURRENT withdrawal ledger on each request.
 const withdrawn=new Set(permissions.records.filter(row=>
   row?.consent==="withdrawn"||!!row?.withdrawnAt).map(row=>row.alias));
 const byPrivateRef=new Map(),accounts=[];
 for(const account of snapshot.accounts){
   const alias=history.canonicalLegacyRef(account?.id);
   if(!alias||!eligibleAliases.has(alias)||withdrawn.has(alias)||
     safePublicTown(account.town)!==account.town||
     account.town==="Town unavailable")continue;
   const publicRef="NBG-"+crypto.createHmac("sha256",secretKey)
     .update("n64-preview-public-first-name-v1:"+alias)
     .digest("hex").slice(0,10).toUpperCase();
   const entry=published.get(publicRef);
   if(!entry||entry.town!==account.town)continue;
   if(typeof account.ref!=="string"||byPrivateRef.has(account.ref))return null;
   accounts.push(account);
   byPrivateRef.set(account.ref,entry);
 }
 if(!accounts.length)return null;
 const record=awards.awards(accounts,{asOf:snapshot.asOf,year,limit:5});
 if(!record)return null;
 const count=(item,key)=>Number.isSafeInteger(item?.[key])&&
   item[key]>0&&item[key]<=100000?item[key]:0;
 const topFive=(list,key)=>Array.isArray(list)?list.slice(0,5)
   .map(item=>{
     const cleans=count(item,key),entry=byPrivateRef.get(item?.ref);
     return cleans&&entry?{
       displayName:entry.displayName,town:entry.town,
       points:entry.points,cleans
     }:null;
   }).filter(Boolean):[];
 const jobCurrent=topFive(record.activeJob,"active");
 const jobHighest=topFive(record.longestJob,"best");
 const allJobsCurrent=topFive(record.combinedCurrent,"activeCombined");
 const allJobsHighest=topFive(record.combined,"combined");
 return {
   status:"preview_public_named_records",
   period,periodEnd:record.periodEnd,sourceAsOf:snapshot.asOf,
   colours:awards.COLOURS.map(colour=>{
     const currentTop=topFive(record.byColourCurrent[colour],"active");
     const highestTop=topFive(record.byColour[colour],"best");
     return {colour,current:currentTop[0]?.cleans||0,
       highest:highestTop[0]?.cleans||0,currentTop,highestTop};
   }),
   longestJobCurrent:jobCurrent[0]?.cleans||0,longestJobCurrentTop:jobCurrent,
   longestJobHighest:jobHighest[0]?.cleans||0,longestJobHighestTop:jobHighest,
   longestAllJobsCurrent:allJobsCurrent[0]?.cleans||0,
   longestAllJobsCurrentTop:allJobsCurrent,
   longestAllJobsHighest:allJobsHighest[0]?.cleans||0,
   longestAllJobsHighestTop:allJobsHighest
 };
}
module.exports={highlights};
