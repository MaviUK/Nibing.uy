"use strict";
import {getStore} from "@netlify/blobs";
import guard from "./lib/squeegeeProductionGuard.js";
import hq from "./lib/customerHQ.js";
import names from "./lib/squeegeeLeaderboardNameConsent.js";
import historical from "./lib/squeegeeActiveLeaderboardImport.js";
import annual from "./lib/squeegeeYearlyPreviewBoard.js";
import board from "./lib/n64ProductionPublicBoard.js";
import customerWebsite from "./lib/arcadeCustomerMerge.js";
import {renderEmailLeaderboardPng} from "./emailLeaderboardCard.mjs";

const HEADERS={"Content-Type":"image/png","Cache-Control":"no-store",
 "X-Robots-Tag":"noindex, nofollow, noarchive",
 "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const response=(bytes,status=200)=>new Response(bytes?new Uint8Array(bytes):null,
 {status,headers:HEADERS});
export default async function handler(request,context){
 if(request.method!=="GET")return response(null,405);
 const url=new URL(request.url);
 if(!guard.isVerifiedProductionScope({hostname:url.hostname,
   deployContext:context?.deploy?.context,siteId:context?.site?.id}))
   return response(null,404);
 if(process.env.N64_PRODUCTION_LEADERBOARD_ENABLED!=="true" ||
    process.env.N64_PRODUCTION_CUSTOMER_HQ_ENABLED!=="true")
   return response(null,404);
 const ref=(url.searchParams.get("ref")||"").trim();
 if(!/^[A-Za-z0-9-]{1,30}$/.test(ref))return response(null,404);
 const key=board.publicSecret(process.env);
 if(!key)return response(null,404);
 try{
  const open=name=>getStore({name,consistency:"strong"});
  const [snapshot,ledger]=await Promise.all([
   open(hq.DATA_STORE).get(hq.DATA_KEY,{type:"json",consistency:"strong"}),
   open(names.STORE_NAME).get(names.KEY,{type:"json",consistency:"strong"})
  ]);
  if(!snapshot||!ledger||ledger.sourceAsOf!==snapshot.asOf)return response(null,404);
  const eligible=hq.eligibleRankedEmailAccounts(snapshot);
  if(!eligible)return response(null,404);
  // Match only consented customers, never reveal whether an unapproved ref exists.
  const matching=ledger.records.filter(row=>row.ref.toLowerCase()===ref.toLowerCase() &&
   row.consent==="granted"&&!row.withdrawnAt &&
   row.noticeVersion===names.NOTICE_VERSION && row.consentAt && row.evidenceRef &&
   eligible.aliases.has(row.alias));
  if(matching.length!==1)return response(null,404);
  const row=matching[0];
  const account=snapshot.accounts.find(a=>a.ref.toLowerCase()===ref.toLowerCase() &&
   historical.canonicalLegacyRef(a.id)===row.alias &&
   a.firstName===row.firstName && a.town===row.town);
  if(!account)return response(null,404);
  const stores={public:open("n64-preview-arcade-public"),
   private:open("n64-preview-arcade-private"),
   links:open("n64-preview1-squeegee-player-links"),
   activity:open(customerWebsite.STORE),
   history:open(historical.BLOB_STORE)};
  const scores=await annual.getDatedScoreBoards(stores,snapshot,eligible.aliases);
  const overall=board.approvedBoard(snapshot,scores.overallBoard,eligible.aliases,ledger,key);
  const yearSource=scores.yearlyBoards.find(b=>b.year===2026);
  const year=yearSource?board.approvedBoard(snapshot,yearSource,eligible.aliases,ledger,key):null;
  if(!overall||!year)return response(null,404);
  // Lookup by the same keyed public identifier used by the approved board.
  const crypto=await import("node:crypto");
  const id="NBG-"+crypto.createHmac("sha256",key)
   .update("n64-preview-public-first-name-v1:"+row.alias)
   .digest("hex").slice(0,10).toUpperCase();
  const overallEntry=overall.entries.find(e=>e.customerRef===id);
  const yearEntry=year.entries.find(e=>e.customerRef===id);
  if(!overallEntry)return response(null,404);
  const bytes=renderEmailLeaderboardPng({
   rank:"#"+overallEntry.rank,
   yearRank:yearEntry?"#"+yearEntry.rank:"NO 2026 XP",
   yearPoints:yearEntry?.points||0,
   points:overallEntry.points,
   job:null,asOf:snapshot.asOf,
   note:"PUBLIC LEADERBOARD STATS ONLY"
  });
  return response(bytes);
 }catch{return response(null,404);}
}
export const config={path:"/api/live-email-leaderboard-card",method:"GET"};
