// Production-only Customer HQ. Preview #77 retains the existing handler.
// No imported customer record is visible until an email OTP AND current,
// read-only Squeegee active-customer check both succeed.
import crypto from "node:crypto";
import {getStore} from "@netlify/blobs";
import {Resend} from "resend";
import gate from "./lib/squeegeeProductionGuard.js";
import data from "./lib/squeegeeProductionCustomerData.js";
import hqAuth from "./lib/customerHQ.js";
import {createProductionClient} from "./lib/squeegeeProductionApi.js";
import {effectiveCleaningStreak} from "./lib/squeegeeCleaningStreak.js";

const PATH="/api/customer-hq";
const ORIGIN="https://nibing.uy";
const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "Pragma":"no-cache",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Vary":"Cookie",
};
const respond=(status,body,extra={})=>
  new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
const store=name=>getStore({name,consistency:"strong"});
const portalStore=()=>store(data.DATA_STORE);
const consentStore=()=>store(data.CONSENT_STORE);
const sessionStore=()=>store(data.AUTH_STORE);
function scope(req,ctx){
  return {hostname:new URL(req.url).hostname,
    deployContext:ctx?.deploy?.context,
    siteId:ctx?.site?.id};
}
function configured(env=process.env){
  return Boolean(data.secret(env) &&
    env?.SQUEEGEE_PRODUCTION_READ_ENABLED==="true" &&
    typeof env?.SQUEEGEE_PRODUCTION_API_KEY==="string" &&
    env.SQUEEGEE_PRODUCTION_API_KEY.trim().length>=20);
}
async function activeAccount(client,account){
  try{
    const live=await client.getCustomer(account.id);
    return hqAuth.validateApiCustomer(live,account);
  }catch{return false;}
}
function accountView(account,snapshot,summary){
  const projected=effectiveCleaningStreak(account.events);
  const streak=Math.min(account.currentStreak,projected.currentStreak);
  const reversed=account.events.map(item=>({...item})).reverse();
  return {
    firstName:account.firstName||null,town:account.town,
    customerReference:account.ref,points:summary.points,
    cleaningPoints:summary.cleaningPoints,
    websiteXp:0,websiteXpStatus:"pending_verified_migration",
    paidCleans:account.paidCleans,currentStreak:streak,
    nextBonus:20+2*streak,streakExpired:projected.expired,
    lastCompletedOn:projected.lastCompletedOn,
    recordedSkippedVisits:account.recordedSkips,
    historyAsOf:snapshot.asOf,history:reversed,
    rewardsHistory:reversed.map(entry=>({
      ...entry,source:"cleaning",category:"cleaning",
      dateKind:"earned",earnedAt:entry.date+"T12:00:00Z",
    })),
    achievementState:null,
  };
}
async function verifiedSession(request,authStore,snapshot,client,now=Date.now()){
  const token=hqAuth.cookieFromHeader(request.headers.get("cookie"));
  const record=await hqAuth.readSession({authStore,token,now});
  if(!record)return null;
  const account=snapshot.accounts.find(x=>x.id===record.customerId);
  if(!account?.email ||
     data.accountForEmail(snapshot,account.email)?.id!==account.id ||
     !await activeAccount(client,account))return null;
  return {account,token};
}
async function sendCode(email,code){
  if(!process.env.RESEND_API_KEY)throw Error("customer_login_mail_not_configured");
  const provider=new Resend(process.env.RESEND_API_KEY);
  const delivered=await provider.emails.send({
    from:process.env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",
    to:email,subject:"Your NI Bin Guy Customer HQ sign-in code",
    text:"Your one-time NI Bin Guy Customer HQ code is: "+code+
      "\n\nThis code expires in 10 minutes. Do not share it."+
      "\nIf you did not request this, ignore this email.",
  });
  if(delivered?.error)throw Error("customer_login_mail_unavailable");
}
export default async function handler(request,context){
  const currentScope=scope(request,context);
  if(!gate.isVerifiedProductionScope(currentScope))
    return respond(404,{error:"not_found"});
  if(!["GET","POST"].includes(request.method))
    return respond(405,{error:"method_not_allowed"});
  // A separate production read switch allows customer sign-in even when
  // automatic Squeegee booking writes are intentionally paused.
  if(!configured(process.env))
    return respond(200,{ready:false,authenticated:false,
      loginMethod:"email_code",reason:"production_setup_pending"});
  const authEnv=data.portalEnv(process.env);
  const ledger=sessionStore();
  const client=createProductionClient({env:process.env,scope:currentScope});
  try{
    const snapshot=await portalStore().get(data.DATA_KEY,{
      type:"json",consistency:"strong",
    });
    if(!data.snapshotFresh(snapshot))
      return respond(200,{ready:false,authenticated:false,
        loginMethod:"email_code",reason:"verified_history_refresh_required",
        sourceAsOf:snapshot?.asOf||null});
    if(request.method==="GET"){
      const session=await verifiedSession(request,ledger,snapshot,client);
      if(!session)return respond(200,{
        ready:true,authenticated:false,
        loginMethod:"email_code",sourceAsOf:snapshot.asOf,
      });
      const consents=await consentStore().get(data.CONSENT_KEY,{
        type:"json",consistency:"strong",
      });
      const chosen=consents?.sourceHash===snapshot.sourceHash?
        consents.records?.find(r=>r.customerId===session.account.id):null;
      const summary=data.personalSummary(snapshot,consents,session.account);
      if(new URL(request.url).searchParams.get("view")==="rank-summary")
        return respond(200,{ready:true,authenticated:true,summary});
      return respond(200,{ready:true,authenticated:true,
        account:accountView(session.account,snapshot,summary),
        leaderboard:{
          ready:!!chosen,
          visible:data.visibleConsent(session.account,chosen),
          displayedFirstName:chosen?.firstName||null,
          noticeVersion:data.NOTICE_VERSION,
        },
        sourceAsOf:snapshot.asOf,
      });
    }
    if(request.headers.get("origin")!==ORIGIN)
      return respond(403,{error:"cross_site_request"});
    const input=await request.text();
    if(input.length>4500)return respond(400,{error:"invalid_request"});
    let body;try{body=JSON.parse(input);}catch{
      return respond(400,{error:"invalid_json"});
    }
    const action=String(body?.action||"");
    if(action==="logout"){
      const token=hqAuth.cookieFromHeader(request.headers.get("cookie"));
      await hqAuth.revokeSession({authStore:ledger,token});
      return respond(200,{authenticated:false},{
        "Set-Cookie":hqAuth.clearCookie(),
      });
    }
    if(action==="request-code"){
      const email=hqAuth.normalizeEmail(body?.email);
      if(!email)return respond(400,{error:"invalid_email"});
      let challengeId=null;
      const account=data.accountForEmail(snapshot,email);
      if(account&&await activeAccount(client,account)){
        try{
          const sent=await hqAuth.issueCode({
            env:authEnv,authStore:ledger,account,send:sendCode,
          });
          if(sent.sent)challengeId=sent.challengeId;
        }catch{}
      }
      return respond(200,{accepted:true,
        challengeId:challengeId||crypto.randomBytes(16).toString("hex"),
        message:"If this address belongs to an active NI Bin Guy account, a code has been emailed.",
      });
    }
    if(action==="verify-code"){
      const customerId=await hqAuth.verifyCode({
        env:authEnv,authStore:ledger,
        challengeId:body?.challengeId,code:body?.code,
      });
      const account=snapshot.accounts.find(x=>x.id===customerId);
      if(!account?.email||
         data.accountForEmail(snapshot,account.email)?.id!==account.id||
         !await activeAccount(client,account))
        return respond(401,{error:"invalid_or_expired_code"});
      const session=await hqAuth.createSession({authStore:ledger,customerId});
      return respond(200,{authenticated:true},{
        "Set-Cookie":hqAuth.setCookie(session.token,session.expiresAt),
      });
    }
    if(action==="sync-website-xp"){
      // Production historical XP must never be reconstructed from an
      // unsigned local cookie. Verified migration is a separate cutover.
      return respond(409,{error:"website_rewards_migration_pending"});
    }
    if(action==="leaderboard-opt-in"||action==="leaderboard-withdraw"){
      const session=await verifiedSession(request,ledger,snapshot,client);
      if(!session)return respond(401,{error:"sign_in_required"});
      const store=consentStore();
      const old=await store.getWithMetadata(data.CONSENT_KEY,{
        type:"json",consistency:"strong",
      });
      if(!old?.data||!old.etag ||
         old.data.sourceHash!==snapshot.sourceHash)
        return respond(409,{error:"consent_setup_pending"});
      const evidence=hqAuth.signature(authEnv,"consent-proof",session.token);
      let next;
      try{
        next=data.updateConsent(old.data,session.account,{
          action,agree:body?.agree===true,firstName:body?.firstName,
          sessionEvidence:evidence,
        });
      }catch(error){
        return respond(409,{error:error?.message||"consent_not_validated"});
      }
      const saved=await store.setJSON(data.CONSENT_KEY,next,{
        onlyIfMatch:old.etag,
      });
      if(saved?.modified!==true || !saved.etag)
        return respond(409,{error:"consent_changed_elsewhere"});
      return respond(200,{saved:true,
        visible:action==="leaderboard-opt-in"});
    }
    return respond(400,{error:"unknown_action"});
  }catch{
    return respond(503,{error:"customer_hq_temporarily_unavailable"});
  }
}
