import crypto from "node:crypto";
// Preview 1: private NI Bin Guy Customer HQ. Passwordless email OTP tied to
// an existing, currently active Squeegee customer, with a private points ledger.
// Never exposes a customer by selecting a public leaderboard row.
import {getStore} from "@netlify/blobs";
import {Resend} from "resend";
import api from "./lib/squeegeeApiV3.js";
import auth from "./lib/customerHQ.js";
import nameConsents from "./lib/squeegeeLeaderboardNameConsent.js";
import {canonicalLegacyRef} from "./lib/squeegeeActiveLeaderboardImport.js";
import merge from "./lib/arcadeCustomerMerge.js";

const ORIGIN="https://deploy-preview-77--nibinguy.netlify.app";
const PATH="/api/customer-hq";
const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "Pragma":"no-cache",
  "X-Robots-Tag":"noindex, nofollow, noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Vary":"Cookie",
};
const respond=(status,payload,extra={})=>new Response(JSON.stringify(payload),{
  status,headers:{...headers,...extra}
});
function scope(request,ctx) {
  return {hostname:new URL(request.url).hostname,
    deployContext:ctx?.deploy?.context,siteId:ctx?.site?.id};
}
const dataStore=()=>getStore({name:auth.DATA_STORE,consistency:"strong"});
const authStore=()=>getStore({name:auth.AUTH_STORE,consistency:"strong"});
const consentStore=()=>getStore({name:nameConsents.STORE_NAME,consistency:"strong"});
const activityStore=()=>getStore({name:merge.STORE,consistency:"strong"});
const arcadeStores=()=>({
  publicStore:getStore({name:"n64-preview-arcade-public",consistency:"strong"}),
  privateStore:getStore({name:"n64-preview-arcade-private",consistency:"strong"}),
  linkStore:getStore({name:"n64-preview1-squeegee-player-links",consistency:"strong"}),
});
async function currentlyActive(id,email){
  const row=await api.getCustomer(id);
  return auth.validateApiCustomer(row,{id,email});
}
async function linkedWebsiteXP(customerId) {
  // Existing verified booking links may have an older contact email.
  // Search those private links by immutable UUID; refuse collisions.
  try {
    const {publicStore,privateStore,linkStore}=arcadeStores();
    const list=await linkStore.list({prefix:"player:"});
    const matches=[];const keys=Array.isArray(list?.blobs)?list.blobs:[];
    if(keys.length>5000)return {points:0,progressXP:0};
    for(const {key} of keys){
      if(!/^player:[a-f0-9]{64}$/.test(String(key||"")))continue;
      const link=await linkStore.get(key,{type:"json"});
      if(link?.verified===true&&link.squeegeeId===customerId){
        matches.push(key);
        if(matches.length>1)return {points:0,progressXP:0};
      }
    }
    if(matches.length!==1)return {points:0,progressXP:0};
    const [player,privatePlayer]=await Promise.all([
      publicStore.get(matches[0],{type:"json"}),
      privateStore.get(matches[0],{type:"json"})
    ]);
    return {points:Number.isSafeInteger(player?.points)?player.points:0,
      progressXP:Number.isSafeInteger(privatePlayer?.progressXP)
        ?privatePlayer.progressXP:0};
  }catch{return {points:0,progressXP:0};}
}
async function customerWebsiteXP(customerId){
  const [linked,activity]=await Promise.all([
    linkedWebsiteXP(customerId),
    merge.readActivity(activityStore(),customerId).catch(()=>0),
  ]);
  return merge.combinedWebsiteXP({
    linkedPoints:linked.points,linkedProgressXP:linked.progressXP,
    portalActivityXP:activity
  });
}
async function attachMatchedWebsiteBooking(session){
  // The email-code login has already verified an ACTIVE Squeegee record.
  // Linking an old booking still requires its exact full name and property.
  try{
    return await merge.linkVerifiedPortalAccount({
      account:session.account,liveCustomer:session.liveCustomer,
      ...arcadeStores()
    });
  }catch{return {linked:false,reason:"link_temporarily_unavailable"};}
}

async function consentChoice(customerId) {
  const saved=await consentStore().get(nameConsents.KEY,{
    type:"json",consistency:"strong"
  });
  const alias=canonicalLegacyRef(customerId);
  const choice=saved?.records?.find(r=>r.alias===alias);
  return {ready:!!choice,
    visible:choice?.consent==="granted"&&!choice.withdrawnAt&&
      choice.noticeVersion===nameConsents.NOTICE_VERSION,
    displayedFirstName:choice?.firstName||null};
}
async function lookupVerifiedSession(request,ledger,now=Date.now()) {
  const token=auth.cookieFromHeader(request.headers.get("cookie"));
  const record=await auth.readSession({authStore:ledger,token,now});
  if(!record)return null;
  const snapshot=await dataStore().get(auth.DATA_KEY,{type:"json",consistency:"strong"});
  const account=snapshot?.accounts?.find(x=>x.id===record.customerId);
  if(!account || !account.email ||
     auth.accountForEmail(snapshot,account.email)?.id!==account.id)return null;
  const liveCustomer=await api.getCustomer(account.id);
  if(!auth.validateApiCustomer(liveCustomer,account))return null;
  return {account,token,liveCustomer};
}
async function sendLoginCode(email,code){
  if(!process.env.RESEND_API_KEY)
    throw new Error("customer_hq_email_not_configured");
  const resend=new Resend(process.env.RESEND_API_KEY);
  const result=await resend.emails.send({
    from:process.env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",
    to:email,
    subject:"Your NI Bin Guy Customer HQ sign-in code",
    text:"Your one-time NI Bin Guy Customer HQ code is: "+code+
      "\n\nIt expires in 10 minutes. The code only opens your cleaning points dashboard."+
      "\nDo not share your code. If you did not request it, you can ignore this email."+
      "\n\nNI Bin Guy",
  });
  if(result?.error)throw new Error("customer_hq_email_failed");
}
export default async function handler(request,context) {
  if(!api.isExactPreview1(process.env,scope(request,context)))
    return respond(404,{error:"not_found"});
  if(!["GET","POST"].includes(request.method))
    return respond(405,{error:"method_not_allowed"});
  const ledger=authStore();
  try {
    if(request.method==="GET"){
      const snapshot=await dataStore().get(auth.DATA_KEY,{type:"json",consistency:"strong"});
      if(!snapshot)return respond(200,{ready:false,authenticated:false,
        loginMethod:"email_code",requiresCustomerIdentityCheck:true});
      const session=await lookupVerifiedSession(request,ledger);
      if(!session)return respond(200,{ready:true,authenticated:false,
        loginMethod:"email_code",sourceAsOf:snapshot.asOf});
      await attachMatchedWebsiteBooking(session);
      const [websiteXp,visibility]=await Promise.all([
        customerWebsiteXP(session.account.id),
        consentChoice(session.account.id),
      ]);
      return respond(200,{ready:true,authenticated:true,
        account:auth.publicAccount(session.account,websiteXp),
        leaderboard:{...visibility,
          noticeVersion:nameConsents.NOTICE_VERSION},
      });
    }
    if(request.headers.get("origin")!==ORIGIN)
      return respond(403,{error:"cross_site_request"});
    const raw=await request.text();
    if(raw.length>4500)return respond(400,{error:"invalid_request"});
    let body;try{body=JSON.parse(raw);}catch{return respond(400,{error:"invalid_json"});}
    const action=String(body?.action||"");
    if(action==="logout"){
      const cookie=auth.cookieFromHeader(request.headers.get("cookie"));
      await auth.revokeSession({authStore:ledger,token:cookie});
      return respond(200,{authenticated:false},{'Set-Cookie':auth.clearCookie()});
    }
    if(action==="request-code"){
      const snapshot=await dataStore().get(auth.DATA_KEY,{type:"json",consistency:"strong"});
      if(!snapshot)return respond(503,{error:"setup_not_complete"});
      const email=auth.normalizeEmail(body?.email);
      if(!email)return respond(400,{error:"invalid_email"});
      // Never reveal whether an email or customer account exists. The sent
      // challenge is indistinguishable from a fake challenge to the browser.
      let challengeId=null;
      const account=auth.accountForEmail(snapshot,email);
      // Account existence, current status, and mail-delivery failures all
      // return the SAME public response. Never disclose who is a customer.
      if(account){
        try{
          if(await currentlyActive(account.id,email)){
            const sent=await auth.issueCode({env:process.env,authStore:ledger,
              account,send:sendLoginCode});
            if(sent.sent)challengeId=sent.challengeId;
          }
        }catch{
          // Fail closed, but do not reveal the presence of the account.
        }
      }
      return respond(200,{accepted:true,
        challengeId:challengeId||crypto.randomBytes(16).toString("hex"),
        message:"If this address belongs to a verified active NI Bin Guy account, a code has been emailed.",
      });
    }
    if(action==="verify-code"){
      const customerId=await auth.verifyCode({
        env:process.env,authStore:ledger,
        challengeId:body?.challengeId,code:body?.code
      });
      if(!customerId)return respond(401,{error:"invalid_or_expired_code"});
      const snapshot=await dataStore().get(auth.DATA_KEY,{type:"json",consistency:"strong"});
      const account=snapshot?.accounts?.find(x=>x.id===customerId);
      if(!account?.email||!await currentlyActive(customerId,account.email))
        return respond(401,{error:"account_cannot_be_verified"});
      const session=await auth.createSession({authStore:ledger,customerId});
      return respond(200,{authenticated:true},{
        "Set-Cookie":auth.setCookie(session.token,session.expiresAt)
      });
    }
    if(action==="sync-website-xp"){
      const session=await lookupVerifiedSession(request,ledger);
      if(!session)return respond(401,{error:"sign_in_required"});
      if(!Array.isArray(body.claimed)||body.claimed.length>200)
        return respond(400,{error:"invalid_website_activity"});
      await attachMatchedWebsiteBooking(session);
      const saved=await merge.syncActivity({
        customerId:session.account.id,claimed:body.claimed,
        store:activityStore(),
      });
      return respond(200,{saved:true,changed:saved.changed,
        websiteXp:await customerWebsiteXP(session.account.id)});
    }
    if(action==="leaderboard-opt-in"||action==="leaderboard-withdraw"){
      const session=await lookupVerifiedSession(request,ledger);
      if(!session)return respond(401,{error:"sign_in_required"});
      const store=consentStore();
      const existing=await store.getWithMetadata(nameConsents.KEY,{
        type:"json",consistency:"strong"
      });
      if(!existing?.data||!existing.etag)return respond(409,{error:"consent_setup_pending"});
      const alias=canonicalLegacyRef(session.account.id);
      const current=existing.data.records.find(r=>r.alias===alias);
      if(!current||current.ref!==session.account.ref)
        return respond(409,{error:"consent_account_not_ready"});
      const next=nameConsents.changeConsent(existing.data,{
        reference:session.account.ref,
        action:action==="leaderboard-opt-in"?"grant":"withdraw",
        method:"portal_email_code",
        evidenceRef:"verified-hq-session:"+
          auth.signature(process.env,"consent-proof",session.token).slice(0,30),
        confirm:body?.agree===true?"yes":"",
        correctedFirstName:typeof body?.firstName==="string"?
          body.firstName.trim():"",
      });
      const saved=await store.setJSON(nameConsents.KEY,next,{
        onlyIfMatch:existing.etag
      });
      if(saved?.modified!==true)
        return respond(409,{error:"consent_updated_elsewhere"});
      return respond(200,{saved:true,
        visible:action==="leaderboard-opt-in"});
    }
    return respond(400,{error:"unknown_action"});
  }catch(error){
    // Never log contact details, OTPs or complete API customer records.
    if(["consent_proof_required","first_name_needs_verification",
         "consent_reference_not_found"].includes(error?.message))
      return respond(422,{error:error.message});
    console.warn("Customer HQ request failed (no customer details logged)");
    return respond(503,{error:"customer_hq_temporarily_unavailable"});
  }
}
// Netlify's static route manifest requires a literal path here, not PATH.
export const config={path:"/api/customer-hq"};
