"use strict";

// The Android in-app browser can omit the Origin header or report "null"
// for an ordinary same-page multipart upload. Origin equality alone must
// therefore NOT be the only CSRF defence.
//
// Bind a form token to the OWNER'S authenticated, signed preview session.
// A third-party website cannot read this token due to the same-origin
// policy. The token expires with the 20-minute owner session, and is
// distinct from tokens for other owner routes.
const crypto = require("node:crypto");

const IMPORT_PATH="/api/squeegee-preview-hq-import";
const IMPORT_ORIGIN="https://deploy-preview-77--nibinguy.netlify.app";

function tokenForOwnerSession(cookie, env=process.env) {
  if(typeof cookie!=="string"||cookie.length<32||cookie.length>256||
     typeof env?.SQUEEGEE_API_KEY!=="string"||
     env.SQUEEGEE_API_KEY.trim().length<20)return null;
  const key=crypto.createHmac("sha256",env.SQUEEGEE_API_KEY)
    .update("nibinguy-n64-preview77-private-hq-import-form-v1")
    .digest();
  return crypto.createHmac("sha256",key)
    .update(IMPORT_PATH+":"+cookie).digest("hex");
}
function equalToken(actual,expected) {
  if(typeof actual!=="string"||typeof expected!=="string"||
     !/^[0-9a-f]{64}$/.test(actual)||
     !/^[0-9a-f]{64}$/.test(expected))return false;
  return crypto.timingSafeEqual(
    Buffer.from(actual,"hex"),Buffer.from(expected,"hex")
  );
}
function isAllowedOwnerUpload({cookie,token,env=process.env,headers}) {
  const expected=tokenForOwnerSession(cookie,env);
  if(!equalToken(token,expected))return false;
  const origin=headers?.get?.("origin")?.trim();
  // Reject an explicitly foreign Origin; treat "null" like an absent
  // Origin ONLY when our session-bound form token is valid.
  if(origin && origin!=="null" && origin!==IMPORT_ORIGIN)return false;
  const fetchSite=headers?.get?.("sec-fetch-site")?.trim().toLowerCase();
  if(fetchSite==="cross-site")return false;
  const referer=headers?.get?.("referer");
  if(referer){
    try{
      if(new URL(referer).origin!==IMPORT_ORIGIN)return false;
    }catch{return false;}
  }
  return true;
}
module.exports={IMPORT_PATH,IMPORT_ORIGIN,
  tokenForOwnerSession,isAllowedOwnerUpload};
