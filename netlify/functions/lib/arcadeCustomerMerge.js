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
const ACTIVITY_POINTS=Object.freeze({
  "l:what-we-do":50,
  "l:the-process":50,
  "l:bins-we-clean":50,
  "l:why-clean-your-bin":50,
  "l:why-ni-bin-guy":50,
  "l:areas-we-cover":50,
  "l:customer-portal":50,
  "l:level-08-final":50,
  "a:coverage":25,
  "a:bin-checker":35,
});
const own=key=>Object.prototype.hasOwnProperty.call(ACTIVITY_POINTS,key);
function activityKeys(input){
  if(!Array.isArray(input)||input.length>200)return [];
  return [...new Set(input.filter(k=>typeof k==="string"&&own(k)))].sort();
}
function activityXP(input){
  return activityKeys(input).reduce((n,k)=>n+ACTIVITY_POINTS[k],0);
}
function bounded(value,cap){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?Math.min(n,cap):0;
}
/**
 * Booking XP is already included in the server website score. Browser
 * activity can also be in that score. Use MAX, not SUM, for activity
 * already credited by either source; the same level never pays twice.
 */
function combinedWebsiteXP({linkedPoints=0,linkedProgressXP=0,portalActivityXP=0}={}){
  const total=bounded(linkedPoints,100000);
  const priorActivity=Math.min(total,bounded(linkedProgressXP,460));
  const loginActivity=bounded(portalActivityXP,460);
  return Math.min(100000,total-priorActivity+
    Math.max(priorActivity,loginActivity));
}
function activityKey(customerId){
  if(!UUID.test(String(customerId||"")))throw new Error("invalid_verified_customer");
  return "customer:"+customerId.toLowerCase();
}
async function readActivity(store,customerId){
  if(!store)return 0;
  const entry=await store.get(activityKey(customerId),{
    type:"json",consistency:"strong"
  });
  return activityXP(entry?.claimed);
}
/**
 * Merge only ten fixed game achievements. Do NOT trust client-sent totals,
 * booking IDs, payment claims or a public leaderboard row ID.
 * Blob compare-and-set stops simultaneous logins losing new achievements.
 */
async function syncActivity({customerId,claimed,store}){
  if(!store||!Array.isArray(claimed)||claimed.length>200)
    throw new Error("invalid_website_activity");
  const incoming=activityKeys(claimed),key=activityKey(customerId);
  if(!incoming.length)return {changed:false,points:await readActivity(store,customerId)};
  for(let attempt=0;attempt<4;attempt++){
    const snap=await store.getWithMetadata(key,{type:"json",consistency:"strong"});
    const old=activityKeys(snap?.data?.claimed);
    const merged=activityKeys(old.concat(incoming));
    if(merged.length===old.length)
      return {changed:false,points:activityXP(merged)};
    const write=await store.setJSON(key,{
      version:1,claimed:merged,updatedAt:new Date().toISOString()
    },snap?.etag?{onlyIfMatch:snap.etag}:{onlyIfNew:true});
    if(write?.modified===true)
      return {changed:true,points:activityXP(merged)};
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
module.exports={STORE,ACTIVITY_POINTS,activityKeys,activityXP,
  combinedWebsiteXP,activityKey,readActivity,syncActivity,
  linkVerifiedPortalAccount};
