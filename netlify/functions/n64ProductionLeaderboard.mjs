import {getStore} from "@netlify/blobs";
import guard from "./lib/squeegeeProductionGuard.js";
import hq from "./lib/customerHQ.js";
import score from "./lib/squeegeeYearlyPreviewBoard.js";
import historical from "./lib/squeegeeActiveLeaderboardImport.js";
import names from "./lib/squeegeeLeaderboardNameConsent.js";
import customerWebsite from "./lib/arcadeCustomerMerge.js";
import board from "./lib/n64ProductionPublicBoard.js";

const HEADERS={"Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow",
 "X-Content-Type-Options":"nosniff"};
const send=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
export default async function handler(request,context){
 const scope={hostname:new URL(request.url).hostname,
   deployContext:context?.deploy?.context,siteId:context?.site?.id};
 if(!guard.isVerifiedProductionScope(scope))return send(404,{error:"not_found"});
 if(request.method!=="GET")return send(405,{error:"method_not_allowed"});
 if(process.env.N64_PRODUCTION_LEADERBOARD_ENABLED!=="true" ||
    process.env.N64_PRODUCTION_CUSTOMER_HQ_ENABLED!=="true")
   return send(503,{error:"production_leaderboard_not_enabled"});
 const key=board.publicSecret(process.env);
 if(!key)return send(503,{error:"leaderboard_signing_not_configured"});
 const year=new URL(request.url).searchParams.get("year");
 const now=Date.now(),availableYears=score.availableYears(now);
 if(year!==null&&(!/^\d{4}$/.test(year)||!score.validYear(Number(year),now)))
   return send(400,{error:"invalid_leaderboard_year"});
 const period=year||"overall";
 try{
  const open=name=>getStore({name,consistency:"strong"});
  const portal=open(hq.DATA_STORE),permission=open(names.STORE_NAME);
  const [privateData,ledger]=await Promise.all([
   portal.get(hq.DATA_KEY,{type:"json",consistency:"strong"}),
   permission.get(names.KEY,{type:"json",consistency:"strong"}),
  ]);
  const eligible=hq.eligibleRankedEmailAccounts(privateData);
  if(!eligible||ledger?.sourceAsOf!==privateData?.asOf)
   return send(503,{error:"verified_history_or_consent_not_ready",
     period,availableYears});
  const stores={public:open("n64-preview-arcade-public"),
   private:open("n64-preview-arcade-private"),
   links:open("n64-preview1-squeegee-player-links"),
   activity:open(customerWebsite.STORE),
   history:open(historical.BLOB_STORE)};
  const full=year===null
    ?(await score.getDatedScoreBoards(stores,privateData,eligible.aliases,now)).overallBoard
    :await score.getAnnualPreviewBoard(stores,privateData,eligible.aliases,Number(year),now);
  const result=board.approvedBoard(privateData,full,eligible.aliases,ledger,key);
  if(!result)return send(503,{error:"verified_leaderboard_unavailable"});
  return send(200,{...result,period,availableYears,
    eligiblePlayers:eligible.count,verifiedPlayers:eligible.verifiedCount,
    eligibleCleaningXp:eligible.historicalPoints,
    publicNamedCount:result.entries.length,
    verifiedAsOf:eligible.verificationAsOf,
    sourceWarning:"Historical scores reflect the dated verified backup; they are not a live Squeegee balance."});
 }catch{return send(503,{error:"verified_leaderboard_temporarily_unavailable"});}
}
export const config={path:"/api/n64-production-leaderboard"};
