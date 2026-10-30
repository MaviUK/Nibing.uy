"use strict";

const crypto = require("node:crypto");
const { isExactPreview1 } = require("./squeegeeApiV3");

const COOKIE_NAME = "__Host-nbg-sq-preview-test";
const COOKIE_VALID_MS = 20 * 60 * 1000;
const OTP_VALID_MS = 15 * 60 * 1000;
const AUTH_STORE_NAME = "squeegee-preview1-owner-test-auth";

function validScope(env = process.env, runtimeScope = null) {
  return isExactPreview1(env,runtimeScope) &&
    typeof env.SQUEEGEE_API_KEY === "string" &&
    env.SQUEEGEE_API_KEY.trim().length >= 20;
}
function sign(env, purpose, message) {
  const root=crypto.createHmac("sha256",env.SQUEEGEE_API_KEY)
    .update("nibinguy-preview77-owner-test-2026").digest();
  return crypto.createHmac("sha256",root)
    .update(purpose + ":" + message).digest("hex");
}
function safeCompareHex(a,b) {
  if (typeof a!=="string" || typeof b!=="string" ||
      !/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b))return false;
  return crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function createTestSessionCookie(env=process.env,now=Date.now(),runtimeScope=null) {
  if(!validScope(env,runtimeScope)) throw new Error("Test session unavailable");
  const nonce=crypto.randomBytes(16).toString("hex");
  const expiry=now+COOKIE_VALID_MS;
  const payload=String(expiry)+"."+nonce;
  return payload+"."+sign(env,"test-session",payload);
}
function verifyTestSessionCookie(cookie,env=process.env,now=Date.now(),runtimeScope=null) {
  if(!validScope(env,runtimeScope) || typeof cookie!=="string" || cookie.length>256)return false;
  const parts=cookie.split(".");
  if(parts.length!==3 || !/^\d{13}$/.test(parts[0]) ||
     !/^[0-9a-f]{32}$/.test(parts[1]))return false;
  const expiry=Number(parts[0]);
  if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+COOKIE_VALID_MS)return false;
  const message=parts[0]+"."+parts[1];
  return safeCompareHex(parts[2],sign(env,"test-session",message));
}
function sessionCookieFromHeader(cookieHeader) {
  if(typeof cookieHeader!=="string" || cookieHeader.length>8192)return "";
  const found=cookieHeader.split(";")
    .map(v=>v.trim()).find(v=>v.startsWith(COOKIE_NAME+"="));
  return found?found.slice(COOKIE_NAME.length+1):"";
}
function cookieHeaderValue(value,maxAgeSec) {
  return COOKIE_NAME+"="+value+
    "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age="+maxAgeSec;
}
function getAuthStore() {
  return require("@netlify/blobs").getStore({
    name:AUTH_STORE_NAME,consistency:"strong",
  });
}
function challengeKey(id){return "challenge/"+id;}
function usedKey(id){return "used/"+id;}
function codeIssueSlot(now) {
  // One fixed 10-minute slot prevents repeated public requests from spamming
  // the owner's mailbox; note that this includes failed-email attempts.
  return "email-window/"+Math.floor(now/(10*60*1000));
}
async function issueOwnerCode({env=process.env,now=Date.now(),store,
  sendCode,runtimeScope=null}={}){
  if(!validScope(env,runtimeScope))return {ok:false,reason:"preview_unavailable"};
  const handle=store||getAuthStore();
  const slot=await handle.setJSON(codeIssueSlot(now),{
    requestedAt:new Date(now).toISOString(),
  },{onlyIfNew:true});
  if(slot?.modified!==true || !slot.etag)
    return {ok:false,reason:"code_recently_sent_or_auth_unavailable"};
  const id=crypto.randomBytes(16).toString("hex");
  const code=String(crypto.randomInt(0,10000000000)).padStart(10,"0");
  const hash=sign(env,"owner-otp",id+":"+code);
  const set=await handle.setJSON(challengeKey(id),{
    hash,expiresAt:now+OTP_VALID_MS,
  },{onlyIfNew:true});
  if(set?.modified!==true || !set.etag)
    return {ok:false,reason:"auth_storage_unavailable"};
  const target=env.BOOKINGS_TO||"info@nibing.uy";
  const dispatch=sendCode || (async({to,code})=>{
    const {Resend}=require("resend");
    const resend=new Resend(env.RESEND_API_KEY);
    const result=await resend.emails.send({
      from:env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",
      to,
      subject:"NI Bin Guy - Preview 1 Squeegee one-booking test code",
      text:"Your one-time Squeegee test access code is: "+code+
        "\n\nEnter it into the Preview 1 test page within 15 minutes."+
        "\nThis only authorises ONE supervised TEST booking, not live customer imports."+
        "\nIf you did not request this, ignore the email.",
    });
    if(result?.error)throw new Error("Test code email unavailable");
  });
  try {
    await dispatch({to:target,code});
  }catch{return {ok:false,reason:"test_code_email_unavailable"};}
  return {ok:true,challengeId:id,expiresAt:now+OTP_VALID_MS};
}
async function verifyOwnerCode({env=process.env,challengeId,code,now=Date.now(),store,
  runtimeScope=null}={}){
  if(!validScope(env,runtimeScope) ||
     !/^[a-f0-9]{32}$/.test(String(challengeId||"")) ||
     !/^\d{10}$/.test(String(code||"")))
    return {ok:false};
  const handle=store||getAuthStore();
  const saved=await handle.get(challengeKey(challengeId),{type:"json",consistency:"strong"});
  if(!saved || !Number.isSafeInteger(saved.expiresAt) ||
    saved.expiresAt<=now || saved.expiresAt>now+OTP_VALID_MS)return {ok:false};
  const expected=sign(env,"owner-otp",challengeId+":"+code);
  if(!safeCompareHex(saved.hash,expected))return {ok:false};
  const consumed=await handle.setJSON(usedKey(challengeId),{
    consumedAt:new Date(now).toISOString(),
  },{onlyIfNew:true});
  if(consumed?.modified!==true || !consumed.etag)return {ok:false};
  return {ok:true,cookie:createTestSessionCookie(env,now,runtimeScope)};
}
module.exports={
  COOKIE_NAME,COOKIE_VALID_MS,OTP_VALID_MS,AUTH_STORE_NAME,
  validScope,createTestSessionCookie,verifyTestSessionCookie,
  sessionCookieFromHeader,cookieHeaderValue,
  issueOwnerCode,verifyOwnerCode,
};
