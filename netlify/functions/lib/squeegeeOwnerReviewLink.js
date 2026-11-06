"use strict";

// Preview #77 only. A private, short-lived capability carried by the OWNER
// notification email, not a session or a new public authentication endpoint.
// Opening it is read-only; a separate POST confirmation and booking claim are
// still required before any Squeegee write.
const crypto=require("node:crypto");
const ORIGIN="https://deploy-preview-77--nibinguy.netlify.app";
const PATH="/api/squeegee-preview-owner-reactivation";
const VALID_MS=7*24*60*60*1000;
const ID_RE=/^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i;
const DAY_RE=/^\d{4}-\d{2}-\d{2}$/;

function validDay(day){
  if(typeof day!=="string" || !DAY_RE.test(day))return false;
  const date=Date.parse(day+"T00:00:00Z");
  return Number.isFinite(date) &&
    new Date(date).toISOString().slice(0,10)===day;
}
function keyFrom(env){
  const key=env?.SQUEEGEE_API_KEY;
  return typeof key==="string" && key.trim().length>=20?key.trim():null;
}
function mac(env,purpose,parts){
  const key=keyFrom(env);
  if(!key)return null;
  return crypto.createHmac("sha256",key)
    .update("nibinguy-preview77-owner-email-v1\n"+purpose+"\n"+parts.join("\n"))
    .digest("hex");
}
function equalHex(a,b){
  return typeof a==="string" && typeof b==="string" &&
    /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) &&
    crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function issueLink(bookingId,day,{env=process.env,now=Date.now()}={}){
  if(!ID_RE.test(String(bookingId||"")) || !validDay(day) ||
     !Number.isSafeInteger(now) || now<=0)return null;
  const expires=String(now+VALID_MS);
  const signature=mac(env,"email-link",[bookingId,day,expires]);
  if(!signature)return null;
  const query=new URLSearchParams({bookingId,day,expires,signature});
  return ORIGIN+PATH+"?"+query.toString();
}
function verifyLink(params,{env=process.env,now=Date.now()}={}){
  const bookingId=params?.bookingId,day=params?.day;
  const expires=params?.expires,signature=params?.signature;
  if(!ID_RE.test(String(bookingId||"")) || !validDay(day) ||
     typeof expires!=="string" || !/^\d{13}$/.test(expires) ||
     !Number.isSafeInteger(now) || now<=0)return false;
  const expiresAt=Number(expires);
  if(!Number.isSafeInteger(expiresAt) || expiresAt<=now ||
     expiresAt>now+VALID_MS)return false;
  return equalHex(signature,
    mac(env,"email-link",[bookingId,day,expires]));
}
function confirmationToken(params,env=process.env){
  return mac(env,"confirm-post",[
    params?.bookingId,params?.day,params?.expires,params?.signature,
  ])||"";
}
module.exports={ORIGIN,PATH,VALID_MS,issueLink,verifyLink,confirmationToken};
