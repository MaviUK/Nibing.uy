"use strict";
/**
 * N64 deploy preview 77: annual leaderboard totals from DATE-VERIFIED
 * customer cleaning visits and website reward events.
 *
 * Overall and annual rankings use the same date-verified awards. Older
 * undated browser XP is excluded from every displayed customer score.
 *
 * All Squeegee UUIDs, emails, booking IDs and contacts remain server-side.
 * The existing eligible-first-name wrapper publishes only opaque aliases.
 */
const active=require("./squeegeeActiveLeaderboardImport");
const snapshot=require("./squeegeeActivePreviewSnapshot");
const binHistory=require("./squeegeePreviewBinHistory");
const merge=require("./arcadeCustomerMerge");
const overdue=require("./squeegeeOverduePenalty");

const FIRST_YEAR=2024;
const FIRST_VERIFIED_YEAR=2000;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PLAYER=/^player:[a-f0-9]{64}$/;
const MAX_KEYS=5000;
const MAX_SCORE=100000;
const batchSize=16;
function supportedPrivateHistory(privateCustomers,now=Date.now()){
  return privateCustomers?.version===1 &&
    Array.isArray(privateCustomers.accounts) &&
    (privateCustomers.asOf===snapshot.AS_OF ||
      (binHistory.isBinSnapshot(privateCustomers) &&
       binHistory.displayable(privateCustomers.asOf,now)));
}


function availableYears(now=Date.now()){
  const final=Math.min(2099,Number(merge.ukDay(now).slice(0,4)));
  return Array.from({length:Math.max(0,final-FIRST_YEAR+1)},
    (_,i)=>FIRST_YEAR+i);
}
function validYear(year,now=Date.now()){
  return Number.isSafeInteger(year)&&
    year>=FIRST_YEAR&&year<=Number(merge.ukDay(now).slice(0,4));
}
// Keep known, dated pre-2024 cleans. Only the public year menu starts 2024.
function validVerifiedYear(year,now=Date.now()){
  return Number.isSafeInteger(year)&&year>=FIRST_VERIFIED_YEAR&&
    year<=Number(merge.ukDay(now).slice(0,4));
}
function annualCleaningXP(events,year,asOf){
  if(!Array.isArray(events))return 0;
  const prefix=String(year)+"-";
  return events.reduce((sum,event)=>{
    if(event?.event!=="paid_completed_clean" ||
       typeof event.date!=="string"||
       !event.date.startsWith(prefix)||
       event.date>asOf ||
       !Number.isSafeInteger(event.points)||
       event.points<=0||event.points>1000)return sum;
    return sum+event.points;
  },0);
}
// Subtract the customer-wide overdue debt only ONCE, then allocate it
// against the most recent earned year first. This preserves the identity:
// Overall XP === sum of displayed annual XP, even with large penalties.
function netCustomerYears(account,webYears,asOf,now=Date.now()){
  const gross=new Map();
  for(const event of Array.isArray(account?.events)?account.events:[]){
    if(event?.event!=="paid_completed_clean"||
       typeof event.date!=="string"||event.date>asOf||
       !Number.isSafeInteger(event.points)||event.points<=0)continue;
    const year=Number(event.date.slice(0,4));
    if(!validVerifiedYear(year,now))continue;
    gross.set(year,(gross.get(year)||0)+event.points);
  }
  for(const [year,points] of webYears instanceof Map?webYears:new Map()){
    if(!validVerifiedYear(year,now)||!Number.isSafeInteger(points)||
       points<0)continue;
    gross.set(year,(gross.get(year)||0)+points);
  }
  const loss=overdue.penaltyTotal(account?.penaltyLedger);
  return overdue.netByYear(gross,loss);
}
function validEarnedDate(at,now){
  const time=typeof at==="string"?Date.parse(at):NaN;
  return Number.isFinite(time)&&time>0&&time<=now+60000
    ?merge.ukDay(time):null;
}
async function visitKeys(store,prefix){
  const all=await store.list({prefix});
  const list=all?.blobs;
  // No silently incomplete rankings on pagination or a storage outage.
  if(!Array.isArray(list)||list.length>MAX_KEYS ||
     all?.next_cursor || all?.nextCursor || all?.cursor) {
    throw new Error("yearly_rewards_store_incomplete");
  }
  return list.map(e=>e.key).filter(key=>typeof key==="string");
}
async function batches(items,operation){
  for(let i=0;i<items.length;i+=batchSize){
    await Promise.all(items.slice(i,i+batchSize).map(operation));
  }
}
function awardInto(map,alias,year,points){
  if(!Number.isSafeInteger(points)||points<=0||points>MAX_SCORE)return;
  if(!map.has(alias))map.set(alias,new Map());
  const years=map.get(alias);
  years.set(year,Math.min(MAX_SCORE,(years.get(year)||0)+points));
}

/**
 * Returns only amounts for verified, already-eligible Squeegee UUIDs.
 * Do NOT include "Recorded on" legacy awards as though they had been
 * earned on that day. Unknown-date XP is excluded from Overall as well.
 */
async function datedWebsiteXP(stores,eligibleAliases,now=Date.now()){
  const credited=new Map();
  if(!stores?.activity||!stores?.links||!stores?.private||!stores?.public)
    throw new Error("yearly_rewards_stores_missing");
  const activityKeys=await visitKeys(stores.activity,"customer:");
  await batches(activityKeys,async key=>{
    if(!key.startsWith("customer:") ||
       !UUID.test(key.slice("customer:".length)))return;
    const alias=active.canonicalLegacyRef(key.slice("customer:".length));
    if(!eligibleAliases.has(alias))return;
    const data=await stores.activity.get(key,{type:"json",consistency:"strong"});
    if(!data)return;
    const {dated}=merge.reconcileActivity(data,now);
    for(const event of dated){
      const earned=validEarnedDate(event.earnedAt,now);
      if(!earned)continue;
      const year=Number(earned.slice(0,4));
      if(validVerifiedYear(year,now))awardInto(credited,alias,year,event.points);
    }
  });
  const linkedPlayers=new Map(),collisions=new Set();
  const linkKeys=await visitKeys(stores.links,"player:");
  await batches(linkKeys,async key=>{
    if(!PLAYER.test(key))return;
    const link=await stores.links.get(key,{type:"json",consistency:"strong"});
    if(link?.verified!==true)return;
    const uuid=String(link.squeegeeId||"").toLowerCase();
    if(!UUID.test(uuid))return;
    const alias=active.canonicalLegacyRef(uuid);
    if(!eligibleAliases.has(alias))return;
    if(linkedPlayers.has(alias))collisions.add(alias);
    else linkedPlayers.set(alias,key);
  });
  await batches([...linkedPlayers.entries()],async([alias,key])=>{
    if(collisions.has(alias))return; // Two website profiles = review, not double XP
    const [player,detail]=await Promise.all([
      stores.public.get(key,{type:"json",consistency:"strong"}),
      stores.private.get(key,{type:"json",consistency:"strong"})
    ]);
    const total=Number(player?.points),progress=Number(detail?.progressXP||0);
    if(!Number.isSafeInteger(total)||total<0||total>MAX_SCORE||
       !Number.isSafeInteger(progress)||progress<0||progress>total)return;
    const booked=Math.max(0,total-progress);
    if(booked===0||!Array.isArray(detail?.bookingAwards))return;
    const seen=new Set(),dated=[];
    let verifiedSum=0;
    for(const item of detail.bookingAwards.slice(0,2000)){
      if(typeof item?.id!=="string"||seen.has(item.id) ||
         !Number.isSafeInteger(item.points)||item.points<=0||
         item.points>30000)continue;
      seen.add(item.id);
      const earned=validEarnedDate(item.at,now);
      if(!earned)continue; // Missing date: Overall only
      verifiedSum+=item.points;
      dated.push({year:Number(earned.slice(0,4)),points:item.points});
    }
    // Never attribute more dated website bookings than the confirmed
    // credited booking balance in the existing overall player record.
    if(verifiedSum>booked)return;
    for(const item of dated)if(validVerifiedYear(item.year,now))
      awardInto(credited,alias,item.year,item.points);
  });
  return credited;
}
async function getAnnualPreviewBoard(stores,privateCustomers,eligibleAliases,year,now=Date.now(),precomputedWeb=null,allowEarlierVerifiedYears=false){
  if(!(allowEarlierVerifiedYears?validVerifiedYear(year,now):validYear(year,now)) ||
     !supportedPrivateHistory(privateCustomers,now) ||
     !(eligibleAliases instanceof Set))
    throw new Error("invalid_yearly_leaderboard_input");
  const annualWeb=precomputedWeb instanceof Map?precomputedWeb:
    await datedWebsiteXP(stores,eligibleAliases,now);
  const rows=[];
  for(const account of privateCustomers.accounts){
    if(!UUID.test(String(account?.id||"").toLowerCase()))continue;
    const alias=active.canonicalLegacyRef(account.id);
    if(!eligibleAliases.has(alias))continue;
    const net=netCustomerYears(account,annualWeb.get(alias),privateCustomers.asOf,now);
    const points=net.get(year)||0;
    // Someone with no earnings during this calendar year is not ranked.
    if(points===0)continue;
    rows.push({customerRef:alias,town:account.town,points});
  }
  rows.sort((a,b)=>b.points-a.points||
    a.customerRef.localeCompare(b.customerRef));
  return {entries:rows,totalPlayers:rows.length,
    status:"squeegee_active_only",
    sourceAsOf:privateCustomers.asOf,
    lastUpdatedAt:privateCustomers.asOf+"T23:59:59Z",
    year};
}
/**
 * One source for all scoring periods. Combine the same dated annual boards
 * to build Overall, excluding undated legacy website balances for everyone.
 * A verified earlier clean keeps its known year. Source archives are kept
 * intact for audit purposes; only the awarded scores change.
 */
async function getDatedScoreBoards(stores,privateCustomers,eligibleAliases,now=Date.now()){
  if(!supportedPrivateHistory(privateCustomers,now) ||
     !(eligibleAliases instanceof Set))
    throw new Error("invalid_dated_leaderboard_input");
  const annualWeb=await datedWebsiteXP(stores,eligibleAliases,now);
  const years=new Set();
  for(const account of privateCustomers.accounts){
    const alias=active.canonicalLegacyRef(account?.id);
    if(!alias || !eligibleAliases.has(alias))continue;
    for(const event of Array.isArray(account.events)?account.events:[]){
      if(event?.event!=="paid_completed_clean" ||
         !/^\d{4}-\d{2}-\d{2}$/.test(String(event.date||"")) ||
         event.date>privateCustomers.asOf ||
         !Number.isSafeInteger(event.points)||event.points<=0||
         event.points>1000)continue;
      const year=Number(event.date.slice(0,4));
      if(validVerifiedYear(year,now))years.add(year);
    }
  }
  for(const [alias,byYear] of annualWeb){
    if(!eligibleAliases.has(alias))continue;
    for(const year of byYear.keys())if(validVerifiedYear(year,now))years.add(year);
  }
  const yearlyBoards=[];
  for(const year of [...years].sort((a,b)=>a-b)){
    yearlyBoards.push(await getAnnualPreviewBoard(
      stores,privateCustomers,eligibleAliases,year,now,annualWeb,true));
  }
  const scores=new Map(),towns=new Map();
  for(const board of yearlyBoards){
    for(const entry of board.entries){
      const total=(scores.get(entry.customerRef)||0)+entry.points;
      if(!Number.isSafeInteger(total)||total>MAX_SCORE)
        throw new Error("dated_leaderboard_total_needs_review");
      scores.set(entry.customerRef,total);
      towns.set(entry.customerRef,entry.town);
    }
  }
  const entries=[...scores].filter(([,points])=>points>0)
    .map(([customerRef,points])=>({customerRef,town:towns.get(customerRef),points}))
    .sort((a,b)=>b.points-a.points||a.customerRef.localeCompare(b.customerRef))
    .map((entry,i)=>({...entry,rank:i+1}));
  return {
    overallBoard:{
      entries,totalPlayers:entries.length,status:"squeegee_active_only",
      sourceAsOf:privateCustomers.asOf,
      lastUpdatedAt:privateCustomers.asOf+"T23:59:59Z"
    },
    yearlyBoards,verifiedWebsiteXP:annualWeb
  };
}
module.exports={FIRST_YEAR,FIRST_VERIFIED_YEAR,availableYears,validYear,
  validVerifiedYear,annualCleaningXP,netCustomerYears,validEarnedDate,datedWebsiteXP,
  getAnnualPreviewBoard,getDatedScoreBoards};
