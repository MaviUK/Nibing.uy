"use strict";
// Customer HQ / Preview 1. No Squeegee writes; no Squeegee credentials in browser.
const crypto=require("node:crypto");
const {canonicalLegacyRef}=require("./squeegeeActiveLeaderboardImport");
const history=require("./squeegeeActivePreviewSnapshot");
const {safePublicTown}=require("./arcadePublicIdentity");
const {RULE_VERSION}=require("./squeegeeCleaningStreak");

const DATA_STORE="n64-preview1-customer-hq-data-private";
const AUTH_STORE="n64-preview1-customer-hq-auth-private";
const DATA_KEY="squeegee-active-customer-history-v1";
const COOKIE="__Host-nbg-customer-hq";
const OTP_MS=10*60*1000,SESSION_MS=12*60*60*1000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMAIL=/^[^\s@]{1,80}@[^\s@]{1,160}\.[^\s@]{2,24}$/;
const EVENTS=new Set(["paid_completed_clean","completed_payment_not_verified","recorded_skip"]);
function normalizeEmail(value){
  if(typeof value!=="string"||value.length>260)return null;
  const s=value.trim().toLowerCase();
  return EMAIL.test(s)?s:null;
}
function secret(env){
  if(!env || typeof env.SQUEEGEE_API_KEY!=="string" ||
    env.SQUEEGEE_API_KEY.length<20)return null;
  return crypto.createHmac("sha256",env.SQUEEGEE_API_KEY)
    .update("preview77:customer-hq:independent-from-owner-otp:v1").digest();
}
function signature(env,tag,data){
  const root=secret(env);
  if(!root)return null;
  return crypto.createHmac("sha256",root).update(tag+":"+data).digest("hex");
}
function hexMatch(a,b){
  return typeof a==="string"&&typeof b==="string"&&
    /^[a-f0-9]{64}$/i.test(a)&&/^[a-f0-9]{64}$/i.test(b)&&
    crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function cookieFromHeader(header){
  if(typeof header!=="string"||header.length>6000)return null;
  const pair=header.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));
  if(!pair)return null;
  const value=pair.slice(COOKIE.length+1);
  return /^[a-f0-9]{64}$/.test(value)?value:null;
}
function setCookie(value,expires){
  return COOKIE+"="+value+"; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age="+
    Math.max(0,Math.floor((expires-Date.now())/1000));
}
function clearCookie(){
  return COOKIE+"=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0";
}
function hashSessionId(id){return crypto.createHash("sha256").update("hq-session:"+id).digest("hex");}
function validateSource(raw){
  if(!raw || raw.version!==1 || raw.asOf!==history.AS_OF ||
     raw.scoringVersion!==RULE_VERSION ||
     !Array.isArray(raw.accounts)||raw.accounts.length!==1022)
    throw new Error("invalid_hq_source");
  const known=new Map(history.ENTRIES.map(([alias,town,points])=>[alias,{town,points}]));
  const seenId=new Set(),seenRef=new Set(),emailCounts=new Map();
  let total=0,rankedCount=0,rankedPoints=0,eventCount=0;
  let rankedWithEmail=0,rankedWithEmailPoints=0;
  const accounts=[];
  for(const item of raw.accounts){
    if(!item || !UUID.test(item.id) ||
      seenId.has(item.id.toLowerCase()) ||
      typeof item.ref!=="string"||!(/^[0-9]{1,12}$|^CUS[0-9]{1,15}$|^[Aa]{2}[0-9]{3,8}$/.test(item.ref))||
      seenRef.has(item.ref.toLowerCase()) ||
      !Number.isSafeInteger(item.points)||item.points<0||item.points>100000 ||
      !Number.isSafeInteger(item.paidCleans)||item.paidCleans<0||item.paidCleans>1000 ||
      !Number.isSafeInteger(item.currentStreak)||item.currentStreak<0||item.currentStreak>1000 ||
      !Number.isSafeInteger(item.nextBonus)||item.nextBonus!==20+2*item.currentStreak ||
      !Number.isSafeInteger(item.recordedSkips)||item.recordedSkips<0 ||
      !Array.isArray(item.events)||item.events.length>2000 ||
      typeof item.town!=="string"||item.town.length>60 ||
      (item.town!=="Town unavailable" && safePublicTown(item.town)!==item.town)||
      typeof item.firstName!=="string"||item.firstName.length>40||
      (item.firstName&&!/^[\p{L}][\p{L}'’\-]{0,39}$/u.test(item.firstName))||
      (item.email!=="" && normalizeEmail(item.email)!==item.email))
      throw new Error("hq_customer_validation_failed");
    seenId.add(item.id.toLowerCase());seenRef.add(item.ref.toLowerCase());
    const alias=canonicalLegacyRef(item.id),expected=known.get(alias);
    if(expected){
      rankedCount++;rankedPoints+=item.points;
      if(item.email){rankedWithEmail++;rankedWithEmailPoints+=item.points;}
      if(expected.points!==item.points||expected.town!==item.town)
        throw new Error("hq_public_score_mismatch");
    }else if(item.points>0&&item.town!=="Town unavailable"){
      throw new Error("unexpected_ranked_hq_customer");
    }
    if(item.email)emailCounts.set(item.email,(emailCounts.get(item.email)||0)+1);
    let scored=0,paid=0,previous="";
    const events=[];
    for(const evt of item.events){
      if(!evt || !/^\d{4}-\d{2}-\d{2}$/.test(evt.date) ||
        evt.date>raw.asOf || evt.date<previous ||
        !EVENTS.has(evt.event) ||
        !Number.isSafeInteger(evt.points)||evt.points<0||evt.points>1000 ||
        !Number.isSafeInteger(evt.streak)||evt.streak<0||evt.streak>1000 ||
        (evt.event==="paid_completed_clean" && evt.points!==20+2*(evt.streak-1))||
        (evt.event!=="paid_completed_clean" && evt.points!==0))
        throw new Error("hq_event_validation_failed");
      previous=evt.date;scored+=evt.points;
      if(evt.event==="paid_completed_clean")paid++;
      events.push({date:evt.date,event:evt.event,points:evt.points,streak:evt.streak});
    }
    if(scored!==item.points||paid!==item.paidCleans)
      throw new Error("hq_history_balance_mismatch");
    total+=scored;eventCount+=events.length;
    accounts.push({id:item.id.toLowerCase(),ref:item.ref,email:item.email,
      firstName:item.firstName,town:item.town,points:item.points,
      paidCleans:item.paidCleans,currentStreak:item.currentStreak,
      nextBonus:item.nextBonus,recordedSkips:item.recordedSkips,events});
  }
  if(rankedCount!==known.size||rankedCount!==941||rankedPoints!==808316)
    throw new Error("hq_active_leaderboard_reconciliation_failed");
  return {version:1,asOf:raw.asOf,scoringVersion:raw.scoringVersion,accounts,
    summary:{activeAccounts:accounts.length,rankedCustomers:rankedCount,
      rankedPoints,rankedWithEmail,rankedWithEmailPoints,
      emailAvailable:accounts.filter(a=>a.email).length,
      duplicateEmailCount:[...emailCounts.values()].filter(n=>n>1).length,
      historyEvents:eventCount,allHistoricalPoints:total}};
}
/**
 * Email is now a mandatory condition for being counted in the historical
 * public leaderboard. Re-use only a private, owner-imported Squeegee backup;
 * never infer eligibility from an individual public player ID or browser data.
 * Existing history is preserved in the private import when email is absent.
 */
function eligibleRankedEmailAccounts(snapshot){
  if(!snapshot || snapshot.version!==1 || snapshot.asOf!==history.AS_OF ||
     snapshot.scoringVersion!==RULE_VERSION ||
     !Array.isArray(snapshot.accounts) || snapshot.accounts.length!==1022)
    return null;
  const known=new Map(history.ENTRIES.map(([alias,town,points])=>
    [alias,{town,points}]));
  const aliases=new Set(),seen=new Set();
  let historicalPoints=0;
  for(const account of snapshot.accounts){
    if(!account || !UUID.test(String(account.id||"")) ||
       seen.has(account.id.toLowerCase()))return null;
    seen.add(account.id.toLowerCase());
    const alias=canonicalLegacyRef(account.id);
    const baseline=known.get(alias);
    if(!baseline)continue;
    if(baseline.town!==account.town ||
       baseline.points!==account.points ||
       typeof account.email!=="string")return null;
    if(account.email && normalizeEmail(account.email)===account.email){
      aliases.add(alias);historicalPoints+=account.points;
    }
  }
  if(seen.size!==1022 || aliases.size>941)return null;
  return {aliases,count:aliases.size,historicalPoints};
}

function accountForEmail(snapshot,email){
  if(!snapshot || snapshot.version!==1 || !Array.isArray(snapshot.accounts))return null;
  const found=snapshot.accounts.filter(a=>a.email===email);
  // Two different Squeegee customers may share a contact email;
  // do not silently pick one or combine their clean histories.
  return found.length===1?found[0]:null;
}
function validateApiCustomer(apiRow,account){
  if(!apiRow || !account || apiRow._id!==account.id ||
     String(apiRow.status||"").toLowerCase()!=="active" ||
     normalizeEmail(apiRow.email)!==account.email)return false;
  return true;
}
function publicAccount(account,websiteXp=0){
  if(!account)return null;
  const xp=Number.isSafeInteger(websiteXp)&&websiteXp>=0?Math.min(100000,websiteXp):0;
  return {firstName:account.firstName||null,town:account.town,
    customerReference:account.ref,points:account.points+xp,
    cleaningPoints:account.points,websiteXp:xp,
    paidCleans:account.paidCleans,currentStreak:account.currentStreak,
    nextBonus:account.nextBonus,recordedSkippedVisits:account.recordedSkips,
    historyAsOf:history.AS_OF,
    history:account.events.map(x=>({...x})).reverse()};
}
async function issueCode({env,now=Date.now(),authStore,account,send}){
  if(!secret(env)||!account?.email||typeof send!=="function")
    return {sent:false};
  const email=normalizeEmail(account.email);
  if(!email)return {sent:false};
  const slot="email-slot/"+signature(env,"email-otp-throttle",
    email+":"+Math.floor(now/(10*60*1000)));
  const hold=await authStore.setJSON(slot,{at:now},{onlyIfNew:true});
  if(hold?.modified!==true||!hold.etag)return {sent:false};
  const challengeId=crypto.randomBytes(16).toString("hex");
  const code=String(crypto.randomInt(0,100000000)).padStart(8,"0");
  const stored=await authStore.setJSON("otp/"+challengeId,{
    hash:signature(env,"customer-hq-otp",challengeId+":"+code),
    customerId:account.id,expiresAt:now+OTP_MS,attempts:0,
  },{onlyIfNew:true});
  if(stored?.modified!==true||!stored.etag)return {sent:false};
  try{await send(account.email,code);}
  catch{return {sent:false};}
  return {sent:true,challengeId};
}
async function verifyCode({env,authStore,challengeId,code,now=Date.now()}){
  if(!secret(env) || !/^[a-f0-9]{32}$/.test(String(challengeId||"")) ||
     !/^\d{8}$/.test(String(code||"")))return null;
  const k="otp/"+challengeId;
  const snap=await authStore.getWithMetadata(k,{type:"json",consistency:"strong"});
  const row=snap?.data;
  if(!row||!snap.etag||!UUID.test(row.customerId) ||
     !Number.isSafeInteger(row.expiresAt) ||
     now>=row.expiresAt||row.expiresAt>now+OTP_MS ||
     !Number.isSafeInteger(row.attempts)||row.attempts>=5)return null;
  const attempts={...row,attempts:row.attempts+1};
  const changed=await authStore.setJSON(k,attempts,{onlyIfMatch:snap.etag});
  if(changed?.modified!==true)return null;
  const expected=signature(env,"customer-hq-otp",challengeId+":"+code);
  if(!hexMatch(row.hash,expected))return null;
  const once=await authStore.setJSON("otp-used/"+challengeId,{at:now},{onlyIfNew:true});
  if(once?.modified!==true||!once.etag)return null;
  return row.customerId.toLowerCase();
}
async function createSession({authStore,customerId,now=Date.now()}){
  if(!UUID.test(customerId))throw new Error("invalid_portal_customer");
  const token=crypto.randomBytes(32).toString("hex");
  const until=now+SESSION_MS;
  const saved=await authStore.setJSON("session/"+hashSessionId(token),{
    customerId:customerId.toLowerCase(),createdAt:now,expiresAt:until,
    revoked:false,
  },{onlyIfNew:true});
  if(saved?.modified!==true||!saved.etag)throw new Error("portal_session_unavailable");
  return {token,expiresAt:until};
}
async function readSession({authStore,token,now=Date.now()}){
  if(!/^[a-f0-9]{64}$/.test(String(token||"")))return null;
  const s=await authStore.get("session/"+hashSessionId(token),
    {type:"json",consistency:"strong"});
  if(!s||s.revoked===true||!UUID.test(s.customerId)||
     !Number.isSafeInteger(s.expiresAt)||s.expiresAt<=now ||
     s.expiresAt>now+SESSION_MS)return null;
  return s;
}
async function revokeSession({authStore,token}){
  if(!/^[a-f0-9]{64}$/.test(String(token||"")))return;
  const key="session/"+hashSessionId(token);
  const old=await authStore.getWithMetadata(key,{type:"json",consistency:"strong"});
  if(old?.data&&old.etag)await authStore.setJSON(key,
    {...old.data,revoked:true},{onlyIfMatch:old.etag});
}
module.exports={DATA_STORE,AUTH_STORE,DATA_KEY,COOKIE,OTP_MS,SESSION_MS,
  normalizeEmail,signature,secret,validateSource,eligibleRankedEmailAccounts,accountForEmail,
  validateApiCustomer,publicAccount,issueCode,verifyCode,
  createSession,readSession,revokeSession,cookieFromHeader,setCookie,clearCookie};
