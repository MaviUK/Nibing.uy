"use strict";
/*
 * Production operator READ-ONLY status login, separate from the customer's
 * email-code login and from Preview 77's owner test cookie.
 *
 * A dedicated secret and exact Netlify production scope are required even
 * when Squeegee writes are paused or not configured.
 */
const crypto=require("node:crypto");
const guard=require("./squeegeeProductionGuard");
const STORE="nibinguy-production-squeegee-owner-auth";
const COOKIE="__Host-nbg-prod-squeegee-owner";
const COOKIE_MS=20*60*1000;
const CODE_MS=15*60*1000;

function configured(env=process.env,scope=null){
  return guard.isVerifiedProductionScope(scope) &&
    typeof env?.SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET==="string" &&
    env.SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET.length>=32;
}
function sign(env,purpose,value) {
  const root=crypto.createHmac("sha256",
    env.SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET)
    .update("nibinguy-production-owner-readonly-v1").digest();
  return crypto.createHmac("sha256",root)
    .update(purpose+":"+value).digest("hex");
}
function matches(a,b){
  return typeof a==="string" && typeof b==="string" &&
    /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) &&
    crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function issueCookie(env=process.env,now=Date.now(),scope=null){
  if(!configured(env,scope))throw Error("Production operator auth unavailable");
  const value=String(now+COOKIE_MS)+"."+crypto.randomBytes(16).toString("hex");
  return value+"."+sign(env,"session",value);
}
function validCookie(cookie,env=process.env,now=Date.now(),scope=null){
  if(!configured(env,scope)||typeof cookie!=="string"||
     cookie.length>256)return false;
  const parts=cookie.split(".");
  if(parts.length!==3||!/^[0-9]{13}$/.test(parts[0])||
     !/^[a-f0-9]{32}$/.test(parts[1]))return false;
  const expiry=Number(parts[0]);
  return Number.isSafeInteger(expiry)&&expiry>now&&expiry<=now+COOKIE_MS &&
    matches(parts[2],sign(env,"session",parts[0]+"."+parts[1]));
}
function fromHeader(header){
  if(typeof header!=="string"||header.length>8192)return "";
  const entry=header.split(";").map(v=>v.trim())
    .find(v=>v.startsWith(COOKIE+"="));
  return entry?entry.slice(COOKIE.length+1):"";
}
function cookieHeader(cookie,maxAge){
  return COOKIE+"="+cookie+
    "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age="+maxAge;
}
async function issueCode({env=process.env,scope=null,store,
  now=Date.now(),sendCode}={}){
  if(!configured(env,scope) || !store?.setJSON ||
     typeof sendCode!=="function")
    return {ok:false,reason:"owner_auth_unavailable"};
  // Global issue slot, not a per-attacker-IP slot: the mailbox cannot be
  // flooded by rotating networks. Failed email delivery also consumes slot.
  const slot="issue-window/"+Math.floor(now/(10*60*1000));
  let hold;
  try{hold=await store.setJSON(slot,{issuedAt:now},{onlyIfNew:true});}
  catch{return {ok:false,reason:"owner_auth_storage_unavailable"};}
  if(hold?.modified!==true || !hold?.etag)
    return {ok:false,reason:"owner_code_recently_requested"};
  const id=crypto.randomBytes(16).toString("hex");
  const code=String(crypto.randomInt(0,10000000000)).padStart(10,"0");
  const hash=sign(env,"otp",id+":"+code);
  let saved;
  try{saved=await store.setJSON("challenge/"+id,{
    hash,expiresAt:now+CODE_MS,
  },{onlyIfNew:true});}
  catch{return {ok:false,reason:"owner_auth_storage_unavailable"};}
  if(saved?.modified!==true || !saved?.etag)
    return {ok:false,reason:"owner_auth_storage_unavailable"};
  try{await sendCode({code,to:"info@nibing.uy"});}
  catch{return {ok:false,reason:"owner_code_delivery_unavailable"};}
  return {ok:true,challengeId:id};
}
async function verifyCode({env=process.env,scope=null,store,
  challengeId,code,now=Date.now()}={}){
  if(!configured(env,scope) || !store?.get || !store?.setJSON ||
     !/^[a-f0-9]{32}$/.test(String(challengeId||"")) ||
     !/^[0-9]{10}$/.test(String(code||"")))
    return {ok:false};
  let entry;
  try{entry=await store.get("challenge/"+challengeId,
    {type:"json",consistency:"strong"});}
  catch{return {ok:false};}
  if(!entry || !Number.isSafeInteger(entry.expiresAt)||
     entry.expiresAt<=now || entry.expiresAt>now+CODE_MS ||
     !matches(entry.hash,sign(env,"otp",challengeId+":"+code)))
    return {ok:false};
  // Atomic one-time consumption; concurrent verification cannot issue
  // more than one signed session from one code.
  let consumed;
  try{consumed=await store.setJSON("consumed/"+challengeId,
    {at:now},{onlyIfNew:true});}
  catch{return {ok:false};}
  if(consumed?.modified!==true || !consumed?.etag)return {ok:false};
  return {ok:true,cookie:issueCookie(env,now,scope)};
}
module.exports={
  STORE,COOKIE,CODE_MS,COOKIE_MS,
  configured,issueCookie,validCookie,fromHeader,cookieHeader,
  issueCode,verifyCode,
};
