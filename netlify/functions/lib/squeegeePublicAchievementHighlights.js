"use strict";
// Preview 77 public teaser: anonymous, high-level records only.
// Never publish winners, names, references, town, job IDs or cleaning dates.
// A customer's withdrawal removes their contribution on every request.
const history=require("./squeegeeActiveLeaderboardImport");
const awards=require("./squeegeePreviewOwnerAchievements");
const {safePublicTown}=require("./arcadePublicIdentity");
const FIRST_YEAR=2024;
function highlights(snapshot,eligibleAliases,permissions,period="overall"){
 if(snapshot?.version!==1||!Array.isArray(snapshot.accounts)||
   typeof snapshot.asOf!=="string"||
   !(eligibleAliases instanceof Set)||
   permissions?.version!==1||
   permissions.sourceAsOf!==snapshot.asOf||
   !Array.isArray(permissions.records))return null;
 const lastYear=Number(snapshot.asOf.slice(0,4));
 const year=period==="overall"?null:Number(period);
 if(year!==null&&(!/^20\d{2}$/.test(String(period))||
   !Number.isSafeInteger(year)||year<FIRST_YEAR||year>lastYear))return null;
 const withdrawn=new Set(permissions.records.filter(row=>
   row?.consent==="withdrawn"||!!row?.withdrawnAt).map(row=>row.alias));
 const accounts=snapshot.accounts.filter(row=>{
   const alias=history.canonicalLegacyRef(row?.id);
   return alias&&eligibleAliases.has(alias)&&!withdrawn.has(alias)&&
     safePublicTown(row.town)===row.town&&row.town!=="Town unavailable";
 });
 if(!accounts.length)return null;
 const record=awards.awards(accounts,{asOf:snapshot.asOf,year,limit:5});
 if(!record)return null;
 const count=(item,key)=>Number.isSafeInteger(item?.[key])&&
   item[key]>0&&item[key]<=100000?item[key]:0;
 // Send ranks and scores only. No persistent customer ID, name, town,
 // job reference or date is attached to any individual record.
 const topFive=(list,key)=>Array.isArray(list)?list.slice(0,5)
   .map(item=>count(item,key)).filter(value=>value>0):[];
 const jobCurrent=topFive(record.activeJob,"active");
 const jobHighest=topFive(record.longestJob,"best");
 const allJobsCurrent=topFive(record.combinedCurrent,"activeCombined");
 const allJobsHighest=topFive(record.combined,"combined");
 return {
   status:"anonymous_verified_records",
   period,periodEnd:record.periodEnd,sourceAsOf:snapshot.asOf,
   colours:awards.COLOURS.map(colour=>{
     const currentTop=topFive(record.byColourCurrent[colour],"active");
     const highestTop=topFive(record.byColour[colour],"best");
     return {colour,current:currentTop[0]||0,highest:highestTop[0]||0,
       currentTop,highestTop};
   }),
   longestJobCurrent:jobCurrent[0]||0,longestJobCurrentTop:jobCurrent,
   longestJobHighest:jobHighest[0]||0,longestJobHighestTop:jobHighest,
   longestAllJobsCurrent:allJobsCurrent[0]||0,
   longestAllJobsCurrentTop:allJobsCurrent,
   longestAllJobsHighest:allJobsHighest[0]||0,
   longestAllJobsHighestTop:allJobsHighest
 };
}
module.exports={highlights};
