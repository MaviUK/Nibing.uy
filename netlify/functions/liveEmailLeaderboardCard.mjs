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
const reject=(reason,status=404)=>{console.warn("[email-leaderboard] "+reason);return response(null,status);};
export default async function handler(request,context){
 if(request.method!=="GET")return reject("method_not_allowed",405);
 const url=new URL(request.url);
 if(!guard.isVerifiedProductionScope({hostname:url.hostname,
   deployContext:context?.deploy?.context,siteId:context?.site?.id}))
   return reject("production_scope");
 if(process.env.N64_PRODUCTION_LEADERBOARD_ENABLED!=="true" ||
    process.env.N64_PRODUCTION_CUSTOMER_HQ_ENABLED!=="true")
   return reject("production_flags");
 const ref=(url.searchParams.get("ref")||"").trim();
 if(!/^[A-Za-z0-9-]{1,30}$/.test(ref))return reject("invalid_reference_format");
 const key=board.publicSecret(process.env);
 if(!key)return reject("public_secret_missing");
 try{
  const open=name=>getStore({name,consistency:"strong"});
  const [snapshot,ledger]=await Promise.all([
   open(hq.DATA_STORE).get(hq.DATA_KEY,{type:"json",consistency:"strong"}),
   open(names.STORE_NAME).get(names.KEY,{type:"json",consistency:"strong"})
  ]);
  if(!snapshot||!ledger||ledger.sourceAsOf!==snapshot.asOf)return reject("snapshot_or_consent_ledger_unavailable");
  const eligible=hq.eligibleRankedEmailAccounts(snapshot);
  if(!eligible)return reject("eligible_accounts_unavailable");
  // Match only consented customers, never reveal whether an unapproved ref exists.
  const matching=(Array.isArray(ledger.records)?ledger.records:[]).filter(row=>String(row?.ref||"").toLowerCase()===ref.toLowerCase() &&
   row.consent==="granted"&&!row.withdrawnAt &&
   row.noticeVersion===names.NOTICE_VERSION && row.consentAt && row.evidenceRef &&
   eligible.aliases.has(row.alias));
  if(matching.length!==1)return reject("consent_or_reference_mismatch");
  const row=matching[0];
  const account=snapshot.accounts.find(a=>String(a?.ref||"").toLowerCase()===ref.toLowerCase() &&
   historical.canonicalLegacyRef(a.id)===row.alias &&
   a.firstName===row.firstName && a.town===row.town);
  if(!account)return reject("account_match_missing");
  const stores={public:open("n64-preview-arcade-public"),
   private:open("n64-preview-arcade-private"),
   links:open("n64-preview1-squeegee-player-links"),
   activity:open(customerWebsite.STORE),
   history:open(historical.BLOB_STORE)};
  const scores=await annual.getDatedScoreBoards(stores,snapshot,eligible.aliases);
  const overall=board.approvedBoard(snapshot,scores.overallBoard,eligible.aliases,ledger,key);
  const yearSource=scores.yearlyBoards.find(b=>b.year===2026);
  const year=yearSource?board.approvedBoard(snapshot,yearSource,eligible.aliases,ledger,key):null;
  if(!overall||!year)return reject("public_boards_unavailable");
  // Lookup by the same keyed public identifier used by the approved board.
  const crypto=await import("node:crypto");
  const id="NBG-"+crypto.createHmac("sha256",key)
   .update("n64-preview-public-first-name-v1:"+row.alias)
   .digest("hex").slice(0,10).toUpperCase();
  const overallEntry=overall.entries.find(e=>e.customerRef===id);
  const yearEntry=year.entries.find(e=>e.customerRef===id);
  if(!overallEntry)return reject("public_entry_missing");
  const bytes=renderEmailLeaderboardPng({
   rank:"#"+overallEntry.rank,
   yearRank:yearEntry?"#"+yearEntry.rank:"NO 2026 XP",
   yearPoints:yearEntry?.points||0,
   points:overallEntry.points,
   job:null,asOf:snapshot.asOf,
   note:"PUBLIC LEADERBOARD STATS ONLY"
  });
  return response(bytes);
 }catch(error){console.error("[email-leaderboard] unexpected_error",error?.name||"Error");return reject("unexpected_error");}
}
export const config={path:"/api/live-email-leaderboard-card",method:"GET"};
