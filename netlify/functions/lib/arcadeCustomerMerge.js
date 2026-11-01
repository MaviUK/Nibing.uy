"use strict";
/**
 * N64 Preview 1 only: safely combine historical Squeegee cleaning points
 * with website XP after the customer authenticates using an email code.
 * Squeegee itself is READ ONLY here. Never use a name/email alone to attach
 * a pre-existing website booking or award booking XP from a browser cookie.
 */
const crypto=require("node:crypto");
const {addressKey,normalName}=require("./squeegeeCustomerMatcher");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE="n64-preview1-customer-website-xp-private";
// Original lifetime achievements are retained for previously earned XP and
// for the two actions that can only be credited once ever.
const LEVEL_IDS=Object.freeze([
  "what-we-do","the-process","bins-we-clean","why-clean-your-bin",
  "why-ni-bin-guy","areas-we-cover","customer-portal","level-08-final",
]);
const ACTIVITY_POINTS=Object.freeze({
  ...Object.fromEntries(LEVEL_IDS.map(id=>["l:"+id,50])),
  "a:coverage":25,
  "a:bin-checker":35,
});
// Per-calendar-month levels; per-UK-calendar-day interactions.
const DAILY_POINTS=Object.freeze({
  "a:free-clean":25,
  "a:customer-portal":25,
  "a:contact":25,
});
const ACTIVITY_LABELS=Object.freeze({
  ...Object.fromEntries(LEVEL_IDS.map((id,i)=>["l:"+id,
    "Website level "+String(i+1).padStart(2,"0")+" completed"])),
  "a:coverage":"Checked service area",
  "a:bin-checker":"Checked bin collection day",
  "a:free-clean":"Played Free Bin Clean challenge",
  "a:customer-portal":"Visited customer portal",
  "a:contact":"Opened Contact Us",
});
const own=key=>Object.prototype.hasOwnProperty.call(ACTIVITY_POINTS,key);
const ownDaily=key=>Object.prototype.hasOwnProperty.call(DAILY_POINTS,key);
const MAX_EVENTS=6000;
const UK_ZONE="Europe/London";
const UK_FORMAT=new Intl.DateTimeFormat("en-GB",{
  timeZone:UK_ZONE,year:"numeric",month:"2-digit",day:"2-digit"
});
function ukDay(input=Date.now()){
  const parts=Object.fromEntries(UK_FORMAT.formatToParts(new Date(input))
    .map(p=>[p.type,p.value]));
  return parts.year+"-"+parts.month+"-"+parts.day;
}
function activityKeys(input){
  if(!Array.isArray(input)||input.length>200)return [];
  return [...new Set(input.filter(k=>typeof k==="string"&&own(k)))].sort();
}
function activityXP(input){
  return activityKeys(input).reduce((n,k)=>n+ACTIVITY_POINTS[k],0);
}
function levelOrdinal(label){
  const match=/^Website level (\d{2}) completed$/.exec(String(label||""));
  const n=Number(match?.[1]);
  return Number.isSafeInteger(n)&&n>=1&&n<=LEVEL_IDS.length?n:null;
}
function bounded(value,cap){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?Math.min(n,cap):0;
}
function normalisePeriodEvent(item,now=Date.now()){
  if(!item||typeof item!=="object"||typeof item.key!=="string")return null;
  const match=/^(l:[a-z0-9-]+|a:[a-z-]+)@(\d{4}-\d{2}(?:-\d{2})?)$/.exec(item.key);
  if(!match)return null;
  const rule=match[1],period=match[2];
  const month=own(rule)&&rule.startsWith("l:");
  const day=ownDaily(rule);
  if((!month&&!day)||(month&&period.length!==7)||
     (day&&period.length!==10))return null;
  // Parse calendar dates strictly (e.g. Feb 30 is not valid).
  const date=period.length===7?period+"-01":period;
  const parsed=new Date(date+"T12:00:00Z");
  if(!Number.isFinite(parsed.getTime())||
     parsed.toISOString().slice(0,10)!==date)return null;
  const today=ukDay(now);
  const current=month?today.slice(0,7):today;
  if(period>current)return null;
  const ageDays=(Date.parse(today+"T12:00:00Z")-parsed.getTime())/86400000;
  // Anonymous events may be synced later, but old or future claims are held.
  if(!Number.isFinite(ageDays) || ageDays<-(month?31:0) ||
     ageDays>(month?100:45))return null;
  let at=typeof item.at==="string"?Date.parse(item.at):NaN;
  if(!Number.isFinite(at) || at>now+60000 ||
     at<now-(month?102:46)*86400000 ||
     (month?ukDay(at).slice(0,7):ukDay(at))!==period){
    // Do not manufacture an event's past timestamp if none is evidenced.
    if(period!==current)return null;
    at=now;
  }
  const points=month?ACTIVITY_POINTS[rule]:DAILY_POINTS[rule];
  return {
    key:item.key,rule,period,points,
    earnedAt:new Date(at).toISOString(),
    label:ACTIVITY_LABELS[rule],
    category:month?"website_level":"website_action",
    date:ukDay(at),
  };
}
/**
 * Original site progress was saved as a lifetime "l:level-id" claim,
 * while the new system saves a dated "l:level-id@YYYY-MM" claim.
 * A migration can therefore preserve TWO records for ONE real award.
 *
 * If an old claim's FIRST KNOWN recorded month matches the dated claim's
 * month, show the dated award and count the overlapping 50 XP only once.
 * If the dated claim is in a DIFFERENT month, both can be genuine monthly
 * rewards; never erase them or rewrite a customer's stored blob.
 *
 * Both the authenticated Customer HQ and the public preview board use this
 * single reconciliation so history and score cannot diverge.
 */
function reconcileActivity(row,now=Date.now()){
  const claimed=activityKeys(row?.claimed);
  const claimSet=new Set(claimed);
  const dated=[];
  const seen=new Set();
  for(const event of Array.isArray(row?.events)?row.events:[]){
    if(!event||typeof event.key!=="string"||seen.has(event.key))continue;
    const valid=normalisePeriodEvent(event,
      Date.parse(event.earnedAt)||now);
    if(!valid)continue;
    seen.add(valid.key);
    dated.push(valid);
  }
  const recordedAt=recordedAtFrom(row,now);
  const recordMonth=ukDay(Date.parse(recordedAt)).slice(0,7);
  const matchedLegacy=new Set();
  for(const entry of dated){
    if(entry.category==="website_level"&&
       entry.period===recordMonth&&claimSet.has(entry.rule)){
      matchedLegacy.add(entry.rule);
    }
  }
  const legacyXP=activityXP(claimed);
  const rawPeriodicXP=dated.reduce((sum,event)=>sum+event.points,0);
  const duplicateXP=[...matchedLegacy].reduce((sum,key)=>
    sum+ACTIVITY_POINTS[key],0);
  return {claimed,dated,recordedAt,matchedLegacy,legacyXP,
    periodicXP:rawPeriodicXP-duplicateXP,duplicateXP,
    total:legacyXP+rawPeriodicXP-duplicateXP};
}
function activityBalance(row){
  const {legacyXP,periodicXP,duplicateXP,total}=reconcileActivity(row);
  return {legacyXP,periodicXP,duplicateXP,total};
}
function sortedRewardsHistory(cleaningHistory,websiteHistory){
  const clean=(Array.isArray(cleaningHistory)?cleaningHistory:[]).map(entry=>({
    ...entry,source:"cleaning",category:"cleaning",
  }));
  return clean.concat(Array.isArray(websiteHistory)?websiteHistory:[])
    .sort((a,b)=>{
      // All activities use newest-first chronology, not numeric level order.
      // Level 08 is earned after Level 07, so it appears ABOVE Level 07.
      const aDate=String(a.date||"");
      const bDate=String(b.date||"");
      if(aDate!==bDate)return bDate.localeCompare(aDate);
      // Same UK day: use original timestamps when available. Older
      // Squeegee imports may carry dates only; display those after events
      // whose precise earning time is available on that same date.
      const aTime=String(a.earnedAt||a.recordedAt||a.date||"");
      const bTime=String(b.earnedAt||b.recordedAt||b.date||"");
      if(aTime!==bTime)return bTime.localeCompare(aTime);
      // When two levels really have an identical stored timestamp, Level 08
      // still appears before 07, then 06 ... 01 (latest progression first).
      const aLevel=a.category==="website_level"?levelOrdinal(a.label):null;
      const bLevel=b.category==="website_level"?levelOrdinal(b.label):null;
      if(aLevel!==null&&bLevel!==null&&aLevel!==bLevel)
        return bLevel-aLevel;
      return 0;
    });
}
function combinedWebsiteXP({
  linkedPoints=0,linkedProgressXP=0,portalActivityXP=0,
  portalPeriodicXP=0
}={}){
  const total=bounded(linkedPoints,100000);
  const priorActivity=Math.min(total,bounded(linkedProgressXP,460));
  const legacy=bounded(portalActivityXP,460);
  // A level credited by the original website and then imported at login
  // counts ONCE. New month/day achievements are additional separate awards.
  return Math.min(100000,total-priorActivity+
    Math.max(priorActivity,legacy)+bounded(portalPeriodicXP,100000));
}
function activityKey(customerId){
  if(!UUID.test(String(customerId||"")))throw new Error("invalid_verified_customer");
  return "customer:"+customerId.toLowerCase();
}
async function readActivityRecord(store,customerId){
  if(!store)return null;
  return store.get(activityKey(customerId),{type:"json",consistency:"strong"});
}
async function readActivity(store,customerId){
  return activityBalance(await readActivityRecord(store,customerId)).total;
}
/**
 * Historic achievements were saved as keys/XP without per-award timestamps.
 * Use the first known time they were persisted, not an invented earning date.
 * A previously imported record can only supply its last saved time; keep
 * calling this "recorded on" in the UI, never "earned on".
 */
function recordedAtFrom(row,now=Date.now()){
  const candidates=["firstRecordedAt","recordedAt","updatedAt",
    "lastUpdatedAt","enrolledAt","createdAt"];
  for(const key of candidates){
    const stamp=row?.[key];
    if(typeof stamp!=="string"&&!Number.isFinite(stamp))continue;
    const ms=typeof stamp==="number"?stamp:Date.parse(stamp);
    if(Number.isFinite(ms)&&ms>946684800000&&ms<=now+60000){
      return new Date(ms).toISOString();
    }
  }
  // When no original timestamp exists, this is the first date this reward
  // was observed by the verified rewards account, NOT an earning date.
  return new Date(now).toISOString();
}
function activityHistory(row,now=Date.now()){
  const {claimed,dated,recordedAt,matchedLegacy}=
    reconcileActivity(row,now);
  // Prefer the actual dated event. Do not create a second "Recorded on"
  // row for the very same monthly level that has already been earned.
  const legacy=claimed.filter(key=>!matchedLegacy.has(key)).map(key=>({
    source:"website",category:key.startsWith("l:")?"website_level":"website_action",
    label:ACTIVITY_LABELS[key],
    date:ukDay(Date.parse(recordedAt)),dateKind:"recorded",
    recordedAt,earnedAt:null,points:ACTIVITY_POINTS[key],
    note:"Exact earning date not saved; this is the account record date",
  }));
  const events=dated.map(item=>({
    source:"website",category:item.category,label:item.label,
    date:item.date,earnedAt:item.earnedAt,points:item.points,
  }));
  return events.concat(legacy);
}
/**
 * Email-code-authenticated users can import old one-time achievements and
 * dated website actions. Server computes amounts from an allowlist and
 * enforces a unique UK-calendar month/day per action using Blob CAS.
 * Website booking points NEVER come from this endpoint.
 */
async function syncActivity({customerId,claimed=[],events=[],store,now=Date.now()}){
  if(!store||!Array.isArray(claimed)||claimed.length>200||
     !Array.isArray(events)||events.length>100)
    throw new Error("invalid_website_activity");
  const incoming=activityKeys(claimed),key=activityKey(customerId);
  // Preserve supplied order. New monthly level awards must follow 01, 02,
  // 03... within that same UK month. A scroll jump cannot award Level 07
  // without Levels 01-06; existing legacy awards are never removed.
  const fresh=new Map();
  for(const item of events){
    const valid=normalisePeriodEvent(item,now);
    if(valid&&!fresh.has(valid.key))fresh.set(valid.key,valid);
  }
  for(let attempt=0;attempt<5;attempt++){
    const snap=await store.getWithMetadata(key,{type:"json",consistency:"strong"});
    const old=activityKeys(snap?.data?.claimed);
    const merged=activityKeys(old.concat(incoming));
    const prior=Array.isArray(snap?.data?.events)?snap.data.events:[];
    const known=new Set(prior.map(e=>e?.key));
    const additional=[];
    for(const event of fresh.values()){
      if(known.has(event.key))continue;
      if(event.category==="website_level"){
        const index=LEVEL_IDS.findIndex(id=>event.rule==="l:"+id);
        if(index<0)continue;
        const previous=LEVEL_IDS.slice(0,index);
        if(!previous.every(id=>known.has("l:"+id+"@"+event.period)))continue;
        // Within a single import batch, a later level may not predate the
        // previous one. Historic already-saved awards remain untouched.
        const prevEvent=additional.findLast(e=>
          e.category==="website_level" && e.period===event.period);
        if(prevEvent && event.earnedAt<prevEvent.earnedAt)continue;
      }
      known.add(event.key);
      additional.push(event);
    }
    if(merged.length===old.length&&!additional.length){
      return {changed:false,points:activityBalance(snap?.data).total};
    }
    if(prior.length+additional.length>MAX_EVENTS)
      throw new Error("activity_ledger_capacity_review");
    const next={version:2,claimed:merged,
      // Preserve the first known date for previously undated rewards.
      firstRecordedAt:recordedAtFrom(snap?.data,now),
      events:prior.concat(additional),updatedAt:new Date(now).toISOString()};
    const saved=await store.setJSON(key,next,
      snap?.etag?{onlyIfMatch:snap.etag}:{onlyIfNew:true});
    if(saved?.modified===true){
      return {changed:true,points:activityBalance(next).total};
    }
  }
  throw new Error("website_activity_concurrent_update");
}
function emailHash(email){
  return crypto.createHash("sha256").update(String(email||"")
    .trim().toLowerCase()).digest("hex");
}
/**
 * Customer HQ independently verified the live Squeegee customer ID, active
 * status and registered email AND sent an OTP to that unique registered
 * email before this function may be called.
 *
 * For existing website booking XP we still need the FULL NAME and the
 * COMPLETE SERVICE PROPERTY (including postcode) from the live Squeegee
 * record. Do not attach a different property merely because emails match.
 */
async function linkVerifiedPortalAccount({account,liveCustomer,
  publicStore,privateStore,linkStore}={}){
  if(!account||!liveCustomer||!UUID.test(String(account.id||""))||
     liveCustomer._id!==account.id ||
     String(liveCustomer.status||"").toLowerCase()!=="active" ||
     !account.email ||
     String(liveCustomer.email||"").trim().toLowerCase()!==account.email ||
     !publicStore||!privateStore||!linkStore)
    return {linked:false,reason:"account_not_verified"};
  const playerKey="player:"+emailHash(account.email);
  const [existing,player,contact]=await Promise.all([
    linkStore.get(playerKey,{type:"json",consistency:"strong"}),
    publicStore.get(playerKey,{type:"json",consistency:"strong"}),
    privateStore.get(playerKey,{type:"json",consistency:"strong"})
  ]);
  if(existing){
    return existing.verified===true &&
      existing.squeegeeId===account.id.toLowerCase()
      ?{linked:true,unchanged:true}
      :{linked:false,reason:"existing_link_conflict"};
  }
  if(!player||!Number.isSafeInteger(player.points)||
     player.points<0||player.points>100000||
     !contact||!(contact.enrolledAt||contact.consentedAt))
    return {linked:false,reason:"no_verified_website_booking"};
  const ids=new Set(Array.isArray(contact.bookingIds)?
    contact.bookingIds.filter(x=>typeof x==="string"):[]);
  if(typeof contact.bookingId==="string")ids.add(contact.bookingId);
  if(ids.size!==1)return {linked:false,reason:"multiple_or_missing_booking_properties"};
  const websiteAddress=addressKey(contact.address);
  const liveAddress=addressKey(liveCustomer.address);
  const websiteName=normalName(contact.name);
  const liveName=normalName(liveCustomer.name);
  if(String(contact.email||"").trim().toLowerCase()!==account.email ||
     !websiteName||!liveName||websiteName!==liveName ||
     !websiteAddress||websiteAddress!==liveAddress)
    return {linked:false,reason:"name_or_service_property_mismatch"};

  // An already linked player with another contact email makes the UUID
  // ambiguous; preserve both balances privately instead of merging.
  const list=await linkStore.list({prefix:"player:"});
  const keys=Array.isArray(list?.blobs)?list.blobs:[];
  if(keys.length>5000)return {linked:false,reason:"link_capacity_review"};
  for(const {key} of keys){
    if(key===playerKey||!/^player:[a-f0-9]{64}$/.test(String(key||"")))continue;
    const other=await linkStore.get(key,{type:"json",consistency:"strong"});
    if(other?.verified===true&&other.squeegeeId===account.id.toLowerCase())
      return {linked:false,reason:"multiple_site_profiles_for_customer"};
  }
  const written=await linkStore.setJSON(playerKey,{
    squeegeeId:account.id.toLowerCase(),verified:true,
    verifiedAt:new Date().toISOString(),
    method:"unique_email_otp_plus_live_squeegee_name_and_service_address",
  },{onlyIfNew:true});
  return written?.modified===true?{linked:true,unchanged:false}:
    {linked:false,reason:"link_race_requires_review"};
}
module.exports={STORE,ACTIVITY_POINTS,DAILY_POINTS,ACTIVITY_LABELS,
  activityKeys,activityXP,ukDay,normalisePeriodEvent,reconcileActivity,activityBalance,
  activityHistory,levelOrdinal,sortedRewardsHistory,recordedAtFrom,readActivityRecord,combinedWebsiteXP,
  activityKey,readActivity,syncActivity,linkVerifiedPortalAccount};
