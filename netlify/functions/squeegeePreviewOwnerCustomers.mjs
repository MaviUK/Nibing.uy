// Preview 77 ONLY. Private, read-only owner customer directory.
// Customer HQ logins and public leaderboard clicks cannot authorise this route.
import {getStore} from "@netlify/blobs";
import api from "./lib/squeegeeApiV3.js";
import owner from "./lib/squeegeePreviewTestSession.js";
import hq from "./lib/customerHQ.js";
import history from "./lib/squeegeeActiveLeaderboardImport.js";
import website from "./lib/arcadeCustomerMerge.js";
import consent from "./lib/squeegeeLeaderboardNameConsent.js";
import personal from "./lib/squeegeePersonalLeaderboard.js";
import directory from "./lib/squeegeePreviewOwnerCustomerDirectory.js";

const PATH="/api/squeegee-preview-owner-customers";
const ORIGIN="https://deploy-preview-77--nibinguy.netlify.app";
const LIMIT=30;
const HEADERS={
 "Content-Type":"text/html; charset=utf-8",
 "Cache-Control":"private, no-store, max-age=0",
 "Pragma":"no-cache","Vary":"Cookie",
 "X-Robots-Tag":"noindex, nofollow, noarchive",
 "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
 "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const css=[
 "*{box-sizing:border-box}html{background:#1b3052}body{margin:0;background:#1b3052;color:#fff8dc;font:16px/1.5 system-ui,sans-serif}a{color:inherit}main{max-width:1080px;margin:auto;padding:16px 15px 55px}",
 "header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:28px}header b{color:#ffe274}header a{font-size:13px}",
 "h1{font-weight:900;font-size:clamp(28px,6vw,42px);line-height:1.15;text-shadow:4px 5px #426187;margin:0 0 10px}h2{font-size:21px;margin:0 0 10px}",
 ".lead{color:#d9e7f6;margin:0 0 21px}.panel,.stat{background:#fff8dc;color:#263958;border:4px solid #b6bdbe;box-shadow:5px 5px 0 #0d2242;padding:16px;margin:16px 0}.panel.blue{background:#dceafa}",
 ".stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.stats .stat{margin:0}.stat b{display:block;color:#185a4c;font-size:clamp(18px,5vw,30px);overflow-wrap:anywhere}.stat small{font-weight:850;text-transform:uppercase;letter-spacing:.03em;font-size:11px}",
 ".search{display:grid;grid-template-columns:minmax(0,2fr) 1fr 1fr auto;gap:10px;align-items:end}.search label{display:block;font-size:12px;font-weight:900;margin:0 0 4px}",
 "input,select{border-radius:0;border:3px solid #586b87;background:white;color:#263958;padding:10px;font:inherit;width:100%;min-height:48px}",
 "button,.btn{background:#ffe274;border:3px solid #223857;color:#223857;border-radius:0;padding:10px 14px;font:900 14px/1.5 system-ui;cursor:pointer;text-decoration:none;display:inline-block;min-height:47px;white-space:normal;text-align:center}",
 ".btn.alt{background:#dceafa}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid white;outline-offset:3px}",
 ".list{margin:0;padding:0;list-style:none;display:grid;gap:8px}.customer{display:flex;justify-content:space-between;gap:10px;border:3px solid #bfc6c0;background:#fff8dc;color:#263958;box-shadow:4px 4px #0e2343;padding:12px 14px;text-decoration:none}",
 ".customer:nth-child(even){background:#dceafa}.customer:hover{outline:3px solid #ffe274}.customer b,.customer small{display:block;overflow-wrap:anywhere}.customer b{font-size:16px}.customer small{font-size:12px;color:#455770}",
 ".customer .points{white-space:nowrap;text-align:right;align-self:center;font-weight:900;color:#185a4c}.meta,.note{font-size:12px;color:#bcd0e6;margin:12px 0}.note{color:#4e627c}",
 ".pager,.tools{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0}.pager span{font-size:12px}dl{display:grid;grid-template-columns:165px 1fr;gap:9px 14px}dt{font-weight:850}dd{margin:0;overflow-wrap:anywhere}",
 ".tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;color:#263958;text-align:left}th,td{padding:10px 7px;border-bottom:2px solid #c9c9ba;font-size:13px}th{background:#dceafa}",
 ".event{display:grid;grid-template-columns:105px 1fr auto;gap:10px;border-bottom:2px solid #ddd8b8;padding:9px 2px;font-size:13px}.event strong{color:#185a4c;white-space:nowrap}.event:nth-child(even){background:#edf2e8}",
 ".tag{display:inline-block;background:#ffe274;border:2px solid #bea953;color:#263958;font-size:11px;font-weight:900;letter-spacing:.05em;padding:4px 8px;margin:0 6px 4px 0}",
 "footer{font-size:12px;color:#bed0e4;margin-top:30px}@media(max-width:720px){.search{grid-template-columns:1fr 1fr}.search .query,.search button{grid-column:1/-1}.stats{gap:7px}.stats .stat{padding:10px}.stats .stat b{font-size:20px}dl{grid-template-columns:1fr}dt{margin-bottom:-8px}}",
 "@media(max-width:400px){main{padding:12px 10px}.panel{padding:12px}.search{grid-template-columns:1fr}.search .query,.search button{grid-column:auto}.customer{padding:10px}.customer .points{font-size:13px}.event{grid-template-columns:85px 1fr auto;gap:6px}.stat small{font-size:10px}}"
].join("");
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
 .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const fmt=n=>(Number(n)||0).toLocaleString("en-GB");
const safeString=(x,max=150)=>typeof x==="string"?x.trim().slice(0,max):"";
const field=(x)=>x?esc(x):'<span style="color:#6a758b">Not available in backup</span>';
function url(params={}){
 const q=new URLSearchParams();
 for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined&&v!=="")q.set(k,String(v));
 return PATH+(q.size?"?"+q.toString():"");
}
function option(value,current,label){
 return '<option value="'+esc(value)+'"'+(current===value?" selected":"")+'>'+esc(label)+'</option>';
}
function respond(title,body,status=200,headers={}){
 const doc='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
 '<meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<meta name="robots" content="noindex,nofollow,noarchive"><title>'+esc(title)+
 ' · NI Bin Guy owner admin</title><style>'+css+'</style></head>'+
 '<body><main><header><b>★ NI BIN GUY · OWNER ADMIN</b>'+
 '<a href="/?ntl-drawer-state=hidden#live-leaderboard">← BACK TO PREVIEW 77</a></header>'+
 body+'<footer>Owner-only, read-only data from a verified Squeegee backup. '+
 'This page cannot change customer permissions, bookings or cleaning scores.</footer></main></body></html>';
 return new Response(doc,{status,headers:{...HEADERS,...headers}});
}
function login(){
 const target="/api/squeegee-preview-test?returnTo="+encodeURIComponent(PATH);
 return respond("Admin login",'<h1>★ ADMIN LOGIN</h1>'+
 '<p class="lead">Search every imported customer and open individual cleaning records.</p>'+
 '<section class="panel"><h2>Verify you are the owner</h2>'+
 '<p>Use the existing one-time owner access code sent to your NI Bin Guy business email. '+
 'Customer HQ sign-ins cannot open this admin area.</p>'+
 '<a class="btn" href="'+esc(target)+'">EMAIL MY OWNER ACCESS CODE →</a>'+
 '<p class="note">The owner session expires after 20 minutes.</p></section>',401);
}
function filters(q,mode,year){
 return '<form class="panel blue search" method="get" action="'+PATH+'" role="search">'+
 '<div class="query"><label for="q">Search all customers</label>'+
 '<input type="search" name="q" id="q" maxlength="90" value="'+esc(q)+
 '" placeholder="First name, email, town, customer ref"></div>'+
 '<div><label for="mode">Customers</label><select name="mode" id="mode">'+
 option("all",mode,"All imported")+option("eligible",mode,"Leaderboard eligible")+
 option("other",mode,"Not eligible")+'</select></div>'+
 '<div><label for="year">XP period</label><select name="year" id="year">'+
 option("overall",year,"Overall")+option("2024",year,"2024")+
 option("2025",year,"2025")+option("2026",year,"2026")+
 '</select></div><button type="submit">★ SEARCH</button></form>';
}
function listPage(snapshot,eligible,params){
 const q=safeString(params.get("q"),90);
 const mode=["all","eligible","other"].includes(params.get("mode"))?params.get("mode"):"all";
 const year=["2024","2025","2026"].includes(params.get("year"))?params.get("year"):"overall";
 const rows=directory.directoryRows(snapshot.accounts,{
  query:q,mode,year:year==="overall"?null:Number(year),
  eligibleAliases:eligible?.aliases||new Set(),
  aliasForId:history.canonicalLegacyRef
 });
 const maxPage=Math.max(1,Math.ceil(rows.length/LIMIT));
 const requested=Number(params.get("page"));
 const page=Number.isSafeInteger(requested)&&requested>0?Math.min(requested,maxPage):1;
 const shown=rows.slice((page-1)*LIMIT,page*LIMIT);
 const stats='<div class="stats">'+
 '<div class="stat"><b>'+fmt(snapshot.accounts.length)+'</b><small>Imported active customers</small></div>'+
 '<div class="stat"><b>'+fmt(eligible?.count??0)+'</b><small>Leaderboard eligible</small></div>'+
 '<div class="stat"><b>'+fmt(snapshot.summary?.verifiedPaidBins??0)+'</b><small>Paid bins recorded</small></div></div>';
 const entries=shown.map(({account,eligible:ranked,periodPoints,periodBins})=>
  '<li><a class="customer" href="'+esc(url({ref:account.ref,q,mode,year,page}))+'">'+
  '<span><b>'+esc(account.firstName||"Name missing")+' · '+esc(account.town)+'</b>'+
  '<small>REF '+esc(account.ref)+' · '+(account.email?esc(account.email):"No email")+'</small>'+
  '<small>'+fmt(periodBins)+' paid bins · '+(ranked?"Leaderboard eligible":"Not eligible")+'</small></span>'+
  '<span class="points">'+fmt(periodPoints)+' XP<br><small>OPEN →</small></span></a></li>'
 ).join("");
 const paging='<div class="pager">'+
 (page>1?'<a class="btn alt" href="'+esc(url({q,mode,year,page:page-1}))+'">← PREVIOUS</a>':"<span>FIRST PAGE</span>")+
 '<span>PAGE '+page+' / '+maxPage+'</span>'+
 (page<maxPage?'<a class="btn alt" href="'+esc(url({q,mode,year,page:page+1}))+'">NEXT →</a>':"<span>LAST PAGE</span>")+
 '</div>';
 const signout='<form method="post" action="'+PATH+'"><input type="hidden" name="action" value="logout">'+
 '<button class="btn alt" type="submit">SIGN OUT</button></form>';
 return respond("Customer directory",
 '<h1>★ CUSTOMER DIRECTORY</h1>'+
 '<p class="lead">Click any record to view private cleaning and XP history. Backup date: <b>'+
 esc(snapshot.asOf)+'</b>.</p>'+stats+filters(q,mode,year)+
 '<div class="tools"><span>'+fmt(rows.length)+' matching customers</span>'+signout+'</div>'+
 (entries?'<ol class="list">'+entries+'</ol>'+paging:
 '<section class="panel"><h2>No matching customers</h2><p>Try a different first name, email, town or Squeegee customer reference.</p></section>')+
 '<p class="meta">List results show verified <b>cleaning XP</b> only. Open a customer to see '+
 'total dated XP, website awards and individual history. Not all imported customers '+
 'qualify for public leaderboard rankings.</p>');
}
function contactDetails(row){
 if(!row||typeof row!=="object")return null;
 const addr=row.address&&typeof row.address==="object"?row.address:{};
 const name=[row.firstName,row.lastName].filter(x=>typeof x==="string"&&x.trim()).join(" ");
 const address=typeof row.address==="string"?row.address:
  row.formattedAddress||row.fullAddress||addr.formattedAddress||
  [addr.line1,addr.line2,addr.city,addr.postcode].filter(x=>typeof x==="string"&&x.trim()).join(", ")||
  [row.addressLine1,row.addressLine2,row.town,row.postcode].filter(x=>typeof x==="string"&&x.trim()).join(", ");
 return {
  name:safeString(name||row.name||row.customerName,160),
  email:safeString(row.email,160),
  phone:safeString(row.mobileNumber||row.mobile||row.phoneNumber||row.phone,75),
  address:safeString(address,240),
  status:safeString(row.status,40)
 };
}
async function detailPage(snapshot,eligible,params,account){
 const alias=history.canonicalLegacyRef(account.id);
 const eligibleForBoard=Boolean(eligible?.aliases?.has(alias));
 const stored={
  public:getStore({name:"n64-preview-arcade-public",consistency:"strong"}),
  private:getStore({name:"n64-preview-arcade-private",consistency:"strong"}),
  links:getStore({name:"n64-preview1-squeegee-player-links",consistency:"strong"}),
  activity:getStore({name:website.STORE,consistency:"strong"}),
  history:getStore({name:history.BLOB_STORE,consistency:"strong"})
 };
 let summary=null,contact=null,visibility="Unverified";
 const results=await Promise.allSettled([
  (async()=>{
   const choices=await getStore({name:consent.STORE_NAME,consistency:"strong"})
    .get(consent.KEY,{type:"json",consistency:"strong"});
   const record=choices?.records?.find(x=>x.alias===alias);
   visibility=record?.consent==="withdrawn"?"Withdrawn":
    record?.consent==="granted"&&!record.withdrawnAt?"Granted":"Pending / not published";
   return personal.getPersonalSummary({
    stores:stored,privateCustomers:snapshot,customerId:account.id,
    consentSnapshot:choices,secretKey:hq.secret(process.env)
   });
  })(),
  api.getCustomer(account.id)
 ]);
 if(results[0].status==="fulfilled")summary=results[0].value;
 if(results[1].status==="fulfilled")contact=contactDetails(results[1].value);
 const clean=directory.cleaningSummary(account);
 const yearly=directory.yearlyCleaning(account);
 const byYear=new Map(yearly.map(row=>[row.year,row]));
 const years=[...new Set([...byYear.keys(),...Object.keys(summary?.yearly||{}).map(Number),2024,2025,2026])]
  .filter(year=>Number.isSafeInteger(year)&&year>=2000&&year<=2099).sort((a,b)=>b-a);
 const back=url({q:safeString(params.get("q"),90),
  mode:params.get("mode")||"all",year:params.get("year")||"overall",page:params.get("page")||"1"});
 const name=contact?.name||account.firstName||"Customer";
 const total=summary?.points??clean.points;
 const intro='<a class="btn alt" href="'+esc(back)+'">← ALL CUSTOMERS</a>'+
 '<h1 style="margin-top:20px">★ '+esc(name)+'</h1>'+
 '<p class="lead">REF '+esc(account.ref)+' · '+esc(account.town)+
 ' · Imported '+esc(snapshot.asOf)+'</p>'+
 '<span class="tag">'+(eligibleForBoard?"LEADERBOARD ELIGIBLE":"NOT PUBLICLY RANKED")+'</span>';
 const stats='<div class="stats">'+
 '<div class="stat"><b>'+fmt(total)+' XP</b><small>'+(summary?"Verified total XP":"Cleaning XP")+'</small></div>'+
 '<div class="stat"><b>'+fmt(clean.points)+' XP</b><small>Cleaning XP</small></div>'+
 '<div class="stat"><b>'+fmt(clean.paidBins)+'</b><small>Paid physical bins</small></div></div>';
 const profile='<section class="panel blue"><h2>Customer details</h2><dl>'+
 '<dt>Name</dt><dd>'+field(contact?.name||account.firstName)+'</dd>'+
 '<dt>Squeegee customer ref</dt><dd>'+esc(account.ref)+'</dd>'+
 '<dt>Email</dt><dd>'+field(contact?.email||account.email)+'</dd>'+
 '<dt>Phone</dt><dd>'+field(contact?.phone)+'</dd>'+
 '<dt>Address / town</dt><dd>'+field(contact?.address||account.town)+'</dd>'+
 '<dt>Live Squeegee status</dt><dd>'+field(contact?.status)+'</dd>'+
 '<dt>Public name consent</dt><dd>'+esc(visibility)+'</dd>'+
 '<dt>Public leaderboard position</dt><dd>'+(
 summary?.rank?"#"+fmt(summary.rank):eligibleForBoard?"Not displayed":"Not eligible")+'</dd>'+
 '<dt>Consecutive clean streaks</dt><dd>'+(Array.isArray(account.jobs)?
  "See individual jobs below":"Older customer-wide import — update required")+'</dd>'+
 '<dt>Next bonus</dt><dd>'+(Array.isArray(account.jobs)?
  "Calculated separately for each job":"Awaiting corrected import")+'</dd>'+
 '<dt>Recorded skips</dt><dd>'+fmt(account.recordedSkips)+'</dd>'+
 '</dl><p class="note">Contact details come from a read-only Squeegee lookup when available. '+
 'The original imported customer history contains first names, towns, email addresses and references.</p></section>';
 const table=years.map(year=>{
  const row=byYear.get(year)||{points:0,paidBins:0};
  const xp=summary?.yearly?.[year]?.points;
  const full=Number.isSafeInteger(xp)?xp:row.points;
  const web=Math.max(0,full-row.points);
  const rank=summary?.yearly?.[year]?.rank;
  return '<tr><td><b>'+year+'</b></td><td>'+fmt(row.paidBins)+'</td>'+
   '<td>'+fmt(row.points)+'</td><td>'+(summary?fmt(web):"—")+'</td>'+
   '<td><b>'+fmt(full)+' XP</b></td><td>'+(rank?"#"+fmt(rank):"—")+'</td></tr>';
 }).join("");
 const annual='<section class="panel"><h2>XP by year</h2><div class="tablewrap">'+
 '<table><thead><tr><th>Year</th><th>Paid bins</th><th>Cleaning XP</th>'+
 '<th>Website XP</th><th>Total XP</th><th>Public position</th></tr></thead>'+
 '<tbody>'+table+'</tbody></table></div>'+
 (summary?"":'<p class="note">Website XP could not be verified just now; cleaning XP remains accurate from the import.</p>')+
 '<p class="note">Dated verified XP only. Undated legacy website awards are not counted as earned on a specific day.</p></section>';
 const perJobPanel=Array.isArray(account.jobs)?
  '<section class="panel"><h2>Consecutive cleans by Squeegee job</h2>'+
  (account.jobs.length?'<div class="tablewrap"><table><thead><tr><th>Job</th><th>Streak</th>'+
    '<th>Next paid bin</th><th>Paid bins</th><th>Earned XP</th><th>Skips</th></tr></thead><tbody>'+
    account.jobs.map((job,index)=>'<tr><td><b>'+esc(job.label)+' #'+(index+1)+'</b><br>'+
      '<small>'+esc(job.id)+'</small></td><td>'+fmt(job.currentStreak)+'</td>'+
      '<td><b>+'+fmt(job.nextBonus)+' XP</b></td><td>'+fmt(job.paidCleans)+'</td>'+
      '<td>'+fmt(job.points)+'</td><td>'+fmt(job.recordedSkips)+'</td></tr>').join("")+
    '</tbody></table></div>':'<p>No recorded job occurrences in this backup.</p>')+
  '<p class="note">Each recurring job has its own consecutive-clean counter. A skipped job only resets itself.</p></section>':
  '<section class="panel"><h2>Per-job streaks need a new backup</h2>'+
  '<p>Stored scores were generated under the older customer-day rule. Reimport the same .sqg backup '+
  'through the private owner import to recalculate accurate job-specific streaks.</p></section>';
 const events=Array.isArray(account.events)?account.events.slice().reverse():[];
 const start=Number(params.get("events"));
 const offset=Number.isSafeInteger(start)&&start>=0?Math.min(start,events.length):0;
 const labels={
  paid_completed_clean:"Paid completed clean",
  completed_payment_not_verified:"Completed; payment not verified",
  completed_non_bin_service:"Non-bin service",
  recorded_skip:"Recorded skip"
 };
 const eventRows=events.slice(offset,offset+40).map(e=>
  '<div class="event"><span>'+esc(e.date)+'</span><span>'+
  esc(labels[e.event]||"Recorded visit")+
  (Array.isArray(account.jobs)&&Number.isSafeInteger(e.j)&&account.jobs[e.j]?
   " · "+esc(account.jobs[e.j].label)+" #"+(e.j+1):"")+
  (Number.isSafeInteger(e.quantity)&&e.quantity>0?" · "+fmt(e.quantity)+" bin(s)":"")+
  (e.event==="paid_completed_clean"?" · streak "+fmt(e.streak):"")+
  '</span><strong>'+fmt(e.points)+' XP</strong></div>').join("");
 const more=offset+40<events.length?'<p><a class="btn alt" href="'+esc(url({
  ref:account.ref,events:offset+40
 }))+'#cleaning-history">SHOW MORE VISITS ↓</a></p>':"";
 const visitHistory='<section class="panel" id="cleaning-history"><h2>Individual cleaning history</h2>'+
 '<p class="note">'+fmt(events.length)+' recorded visits/events · newest first</p>'+
 (eventRows||"<p>No events in this backup.</p>")+more+
 '<p class="note">The scoring import records physical-bin quantities and dates, '+
 'but not the colour of each historical bin.</p></section>';
 return respond("Customer "+account.ref,intro+stats+profile+perJobPanel+annual+visitHistory);
}
function runtimeScope(req,ctx){
 return {hostname:new URL(req.url).hostname,deployContext:ctx?.deploy?.context,siteId:ctx?.site?.id};
}
export default async function handler(request,context){
 const scope=runtimeScope(request,context);
 if(!api.isExactPreview1(process.env,scope))
  return new Response("Not found",{status:404,headers:HEADERS});
 if(!["GET","POST"].includes(request.method))
  return new Response("Method not allowed",{status:405,headers:HEADERS});
 const cookie=owner.sessionCookieFromHeader(request.headers.get("cookie"));
 if(!owner.verifyTestSessionCookie(cookie,process.env,Date.now(),scope))return login();
 if(request.method==="POST"){
  if(request.headers.get("origin")!==ORIGIN)
   return respond("Forbidden","<h1>Invalid sign-out request</h1>",403);
  const body=await request.formData();
  if(body.get("action")!=="logout")
   return respond("Bad request","<h1>Unknown action</h1>",400);
  const headers=new Headers({"Location":PATH,"Cache-Control":"no-store"});
  headers.append("Set-Cookie",owner.cookieHeaderValue("",0));
  headers.append("Set-Cookie","nbgSqTestArmed=; Path=/; Secure; SameSite=Strict; Max-Age=0");
  return new Response(null,{status:303,headers});
 }
 try{
  const snapshot=await getStore({name:hq.DATA_STORE,consistency:"strong"})
   .get(hq.DATA_KEY,{type:"json",consistency:"strong"});
  if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.accounts))
   return respond("Import needed",'<h1>Private customer history not imported</h1>'+
    '<p class="lead">Upload the latest verified Squeegee backup first.</p>'+
    '<a class="btn" href="/api/squeegee-preview-hq-import">OPEN PRIVATE IMPORT →</a>',503);
  const eligible=hq.eligibleRankedEmailAccounts(snapshot);
  const params=new URL(request.url).searchParams;
  const ref=safeString(params.get("ref"),32);
  if(ref){
   const account=snapshot.accounts.find(row=>String(row.ref).toLowerCase()===ref.toLowerCase());
   return account?await detailPage(snapshot,eligible,params,account):
    respond("Not found",'<h1>Customer not found</h1>'+
     '<p>This reference is not present in the imported history.</p>'+
     '<a class="btn" href="'+PATH+'">ALL CUSTOMERS →</a>',404);
  }
  return listPage(snapshot,eligible,params);
 }catch{
  // Do not log the owner's cookies or any private imported customer data.
  console.warn("Private owner directory temporarily unavailable");
  return respond("Unavailable",'<h1>Directory temporarily unavailable</h1>'+
   '<p>The private customer records could not be read. Nothing was changed.</p>'+
   '<a class="btn" href="'+PATH+'">RETRY →</a>',503);
 }
}
export const config={
 path:"/api/squeegee-preview-owner-customers",
 rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:90}
};
