"use strict";
/**
 * N64 deploy preview 77: annual leaderboard totals from DATE-VERIFIED
 * customer cleaning visits and website reward events.
 *
 * The lifetime board remains untouched. In particular, a legacy browser XP
 * balance without individual earned-at dates is not silently placed in 2026.
 *
 * All Squeegee UUIDs, emails, booking IDs and contacts remain server-side.
 * The existing eligible-first-name wrapper publishes only opaque aliases.
 */
const active=require("./squeegeeActiveLeaderboardImport");
const snapshot=require("./squeegeeActivePreviewSnapshot");
const merge=require("./arcadeCustomerMerge");

const FIRST_YEAR=2024;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PLAYER=/^player:[a-f0-9]{64}$/;
const MAX_KEYS=5000;
const MAX_SCORE=100000;
const batchSize=16;

function availableYears(now=Date.now()){
  const final=Math.min(2099,Number(merge.ukDay(now).slice(0,4)));
  return Array.from({length:Math.max(0,final-FIRST_YEAR+1)},
    (_,i)=>FIRST_YEAR+i);
}
function validYear(year,now=Date.now()){
  return Number.isSafeInteger(year)&&
    year>=FIRST_YEAR&&year<=Number(merge.ukDay(now).slice(0,4));
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
 * earned on that day; those stay in Overall until dated evidence exists.
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
      if(validYear(year,now))awardInto(credited,alias,year,event.points);
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
    for(const item of dated)if(validYear(item.year,now))
      awardInto(credited,alias,item.year,item.points);
  });
  return credited;
}
async function getAnnualPreviewBoard(stores,privateCustomers,eligibleAliases,year,now=Date.now()){
  if(!validYear(year,now) ||
     privateCustomers?.version!==1 ||
     privateCustomers?.asOf!==snapshot.AS_OF ||
     !Array.isArray(privateCustomers.accounts) ||
     !(eligibleAliases instanceof Set))
    throw new Error("invalid_yearly_leaderboard_input");
  const annualWeb=await datedWebsiteXP(stores,eligibleAliases,now);
  const rows=[];
  for(const account of privateCustomers.accounts){
    if(!UUID.test(String(account?.id||"").toLowerCase()))continue;
    const alias=active.canonicalLegacyRef(account.id);
    if(!eligibleAliases.has(alias))continue;
    const clean=annualCleaningXP(account.events,year,privateCustomers.asOf);
    const web=annualWeb.get(alias)?.get(year)||0;
    const points=Math.min(MAX_SCORE,clean+web);
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
module.exports={FIRST_YEAR,availableYears,validYear,annualCleaningXP,
  validEarnedDate,datedWebsiteXP,getAnnualPreviewBoard};
