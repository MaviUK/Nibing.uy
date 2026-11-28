"use strict";

// A short-lived, server-signed pre-login form token. Samsung/Android in-app
// browsers sometimes omit Origin or send "null" on an otherwise same-origin
// HTML form POST. Never relax Origin checks without this independent CSRF proof.
const crypto=require("node:crypto");
const COOKIE="__Host-nbg-prod-leaderboard-login-csrf";
const WINDOW_MS=20*60*1000;
const ORIGIN="https://nibing.uy";
function secret(env) {
  const value=env?.SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET;
  return typeof value==="string"&&value.length>=32?value:null;
}
function sign(env,value){
  const root=crypto.createHmac("sha256",secret(env))
    .update("nibinguy-leaderboard-login-csrf-v1").digest();
  return crypto.createHmac("sha256",root).update(value).digest("hex");
}
function issueToken(env=process.env,now=Date.now()){
  if(!secret(env)||!Number.isSafeInteger(now))return null;
  const value=String(now+WINDOW_MS)+"."+crypto.randomBytes(16).toString("hex");
  return value+"."+sign(env,value);
}
function fromHeader(header){
  if(typeof header!=="string"||header.length>8192)return "";
  const entry=header.split(";").map(x=>x.trim())
    .find(x=>x.startsWith(COOKIE+"="));
  return entry?entry.slice(COOKIE.length+1):"";
}
function cookieHeader(token){
  return COOKIE+"="+token+
    "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age="+Math.floor(WINDOW_MS/1000);
}
function equal(a,b){
  return typeof a==="string"&&typeof b==="string"&&a.length===b.length&&
    /^[0-9a-f.]+$/.test(a)&&/^[0-9a-f.]+$/.test(b)&&
    crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
function tokenValid(token,env=process.env,now=Date.now()){
  if(!secret(env)||typeof token!=="string"||token.length>256)return false;
  const m=/^([0-9]{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if(!m)return false;
  const expiry=Number(m[1]);
  if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+WINDOW_MS)return false;
  return equal(m[3],sign(env,m[1]+"."+m[2]));
}
function isAllowed({cookie,formToken,env=process.env,headers,now=Date.now()}={}){
  if(!tokenValid(cookie,env,now)||!equal(cookie,formToken))return false;
  const origin=headers?.get?.("origin")?.trim();
  // A concrete foreign origin is always rejected. "null"/missing is only
  // accepted when the signed cookie and the same-page form token match.
  if(origin&&origin!=="null"&&origin!==ORIGIN)return false;
  if(headers?.get?.("sec-fetch-site")?.trim().toLowerCase()==="cross-site")return false;
  const referer=headers?.get?.("referer");
  if(referer){
    try{if(new URL(referer).origin!==ORIGIN)return false;}
    catch{return false;}
  }
  return true;
}
module.exports={COOKIE,WINDOW_MS,ORIGIN,issueToken,fromHeader,cookieHeader,tokenValid,isAllowed};
