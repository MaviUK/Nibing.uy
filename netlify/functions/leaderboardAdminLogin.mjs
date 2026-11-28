import owner from "./lib/leaderboardOwnerAuth.js";
import guard from "./lib/squeegeeProductionGuard.js";
import {getStore} from "@netlify/blobs";
import {Resend} from "resend";

const LOGIN="/leaderboard-admin/login";
const ORIGIN="https://nibing.uy";
const ADMIN="/leaderboard-admin";
const UPLOAD=ADMIN+"/upload";
const safeTarget=value=>value===UPLOAD?UPLOAD:ADMIN;
const HEADERS={
 "Content-Type":"text/html; charset=utf-8",
 "Cache-Control":"private, no-store, max-age=0",
 "X-Robots-Tag":"noindex, nofollow, noarchive",
 "X-Content-Type-Options":"nosniff",
 "Referrer-Policy":"no-referrer",
 "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
function page(body,status=200){
 return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NI Bin Guy - Leaderboard Admin</title><style>body{background:#121728;color:white;font:16px/1.5 system-ui;margin:0;padding:20px}main{max-width:540px;margin:auto;background:#28334c;border-left:4px solid #f7c948;padding:20px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:10px 0;font:inherit}button{background:#f7c948;color:#171717;border:0;font-weight:800}a{color:#f7c948}</style><main><h1>Leaderboard Admin</h1>'+body+'</main>',{status,headers:HEADERS});
}
function requestForm(target){
 return '<p>Owner only. Request a one-time sign-in code sent to the NI Bin Guy business mailbox.</p><form method="post" action="'+LOGIN+'"><input type="hidden" name="action" value="request"><input type="hidden" name="returnTo" value="'+target+'"><button>Email my owner code</button></form>';
}
function codeForm(target,id){
 if(!/^[a-f0-9]{32}$/.test(String(id||"")))return requestForm(target);
 return '<p>Enter the 10-digit code sent to the owner mailbox.</p><form method="post" action="'+LOGIN+'"><input type="hidden" name="action" value="verify"><input type="hidden" name="returnTo" value="'+target+'"><input type="hidden" name="challengeId" value="'+id+'"><label for="code">One-time code</label><input id="code" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" required><button>Sign in</button></form>';
}
function redirect(target,cookie){
 return new Response(null,{status:303,headers:{...HEADERS,Location:target,...(cookie?{"Set-Cookie":owner.cookieHeader(cookie,1200)}:{})}});
}
export default async function handler(request,context){
 const scope={hostname:new URL(request.url).hostname,deployContext:context?.deploy?.context,siteId:context?.site?.id};
 if(!guard.isVerifiedProductionScope(scope))return new Response("Not found",{status:404,headers:HEADERS});
 if(!owner.configured(process.env,scope))return page("<p>Owner authentication is not configured. No customer data is available.</p>",503);
 const url=new URL(request.url);
 if(request.method==="GET"){
   const target=safeTarget(url.searchParams.get("returnTo"));
   if(owner.validCookie(owner.fromHeader(request.headers.get("cookie")),process.env,Date.now(),scope))return redirect(target);
   return page(requestForm(target));
 }
 if(request.method!=="POST")return page("<p>Method not allowed.</p>",405);
 if(request.headers.get("origin")!==ORIGIN||request.headers.get("sec-fetch-site")==="cross-site")return page("<p>Invalid sign-in origin. Open the live admin page and try again.</p>",403);
 if(!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))return page("<p>Invalid form.</p>",400);
 const raw=await request.text();
 if(raw.length>2048)return page("<p>Invalid form.</p>",413);
 const form=new URLSearchParams(raw),target=safeTarget(form.get("returnTo"));
 const store=getStore({name:owner.STORE,consistency:"strong"});
 try{
   if(form.get("action")==="request"){
     const outcome=await owner.issueCode({scope,store,sendCode:async({to,code})=>{
       const result=await new Resend(process.env.RESEND_API_KEY).emails.send({
         from:process.env.RESEND_FROM||"NI Bin Guy <noreply@nibing.uy>",to,
         subject:"NI Bin Guy - Leaderboard Admin access code",
         text:"Your one-time Leaderboard Admin code is: "+code+"\n\nExpires in 15 minutes. This signs you into the private leaderboard admin, including backup updates. If you did not request it, ignore this email."
       });
       if(result?.error||!result?.data?.id)throw Error("Email delivery unavailable");
     }});
     return outcome.ok?page(codeForm(target,outcome.challengeId)):page("<p>A code was recently requested or delivery is unavailable.</p>"+requestForm(target),429);
   }
   if(form.get("action")==="verify"){
     const id=form.get("challengeId");
     const verified=await owner.verifyCode({scope,store,challengeId:id,code:form.get("code")});
     return verified.ok?redirect(target,verified.cookie):page("<p>Code invalid, expired or already used.</p>"+codeForm(target,id),401);
   }
   return page("<p>Invalid action.</p>",400);
 }catch{return page("<p>Owner sign-in is temporarily unavailable.</p>",503);}
}
export const config={path:"/leaderboard-admin/login",rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:10}};
