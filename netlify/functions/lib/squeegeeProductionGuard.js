"use strict";

/**
 * Production release admission policy for the isolated Squeegee writer.
 * Preview-only workers must never use these rights. All production secrets and
 * write switches remain unset while release work is in a draft PR.
 *
 * Every secret and switch is independent of Preview #77. All switches default
 * to OFF; reading env flags never creates a Netlify variable or an API key.
 */
const crypto=require("node:crypto");
const PRODUCTION_HOST="nibing.uy";
const SITE_ID="d63c829f-3ed7-48e9-9633-a042de3f2e84";
const CLAIM_PREFIX="claim-v1/production/auto-bookings/";
const BOOKING_RE=/^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i;
const SIGNING_DOMAIN="nibinguy-production-booking-event-v1";
const MAX_AGE_MS=90*1000;

function isVerifiedProductionScope(scope) {
  return scope?.hostname===PRODUCTION_HOST &&
    scope?.deployContext==="production" &&
    scope?.siteId===SITE_ID;
}

function productionConfigured(env=process.env,scope=null) {
  const key=env?.SQUEEGEE_PRODUCTION_API_KEY;
  const eventSecret=env?.SQUEEGEE_PRODUCTION_EVENT_SECRET;
  return isVerifiedProductionScope(scope) &&
    env?.SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED==="true" &&
    env?.SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES==="true" &&
    env?.SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY==="true" &&
    env?.SQUEEGEE_PRODUCTION_WRITES_PAUSED==="false" &&
    typeof key==="string" && key.trim().length>=20 &&
    typeof eventSecret==="string" && eventSecret.length>=32;
}

function admittedClaim(proof) {
  if(proof?.acquired!==true || typeof proof?.key!=="string" ||
     !proof.key.startsWith(CLAIM_PREFIX) ||
     typeof proof.etag!=="string" || proof.etag.length<4) return false;
  const id=proof.key.slice(CLAIM_PREFIX.length);
  return BOOKING_RE.test(id);
}

// Authorization requires BOTH the independently configured production release
// gate and an immutable, server-side atomic claim obtained by the future
// production handler. It is not a browser-callable permission or bypass.
function productionWriteAdmission({env=process.env,scope=null,proof=null}={}) {
  return productionConfigured(env,scope) && admittedClaim(proof);
}

function eventKey(env) {
  const secret=env?.SQUEEGEE_PRODUCTION_EVENT_SECRET;
  if(typeof secret!=="string" || secret.length<32) return null;
  return crypto.createHmac("sha256",secret).update(SIGNING_DOMAIN).digest();
}

function signProductionEvent(body,timestamp,{env=process.env,scope=null}={}) {
  if(!productionConfigured(env,scope) ||
     typeof body!=="string" || body.length>30000 ||
     !/^\d{13}$/.test(String(timestamp||"")))return null;
  const key=eventKey(env);
  if(!key)return null;
  return crypto.createHmac("sha256",key)
    .update(String(timestamp)+"\n"+body).digest("hex");
}

function verifyProductionEvent(body,timestamp,signature,{
  env=process.env,scope=null,now=Date.now(),
}={}) {
  if(!productionConfigured(env,scope) ||
     typeof body!=="string" || body.length>30000 ||
     !/^\d{13}$/.test(String(timestamp||"")) ||
     !/^[a-f0-9]{64}$/i.test(String(signature||"")) ||
     !Number.isSafeInteger(now))return false;
  const age=now-Number(timestamp);
  if(age< -30000 || age>MAX_AGE_MS)return false;
  const expected=signProductionEvent(body,timestamp,{env,scope});
  if(!expected)return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected,"hex"),Buffer.from(signature,"hex"));
}

module.exports={
  PRODUCTION_HOST,SITE_ID,CLAIM_PREFIX,SIGNING_DOMAIN,
  isVerifiedProductionScope,productionConfigured,
  admittedClaim,productionWriteAdmission,
  signProductionEvent,verifyProductionEvent,
};
