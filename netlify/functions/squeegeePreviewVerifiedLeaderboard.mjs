// PRIVATE owner-only leaderboard for NI Bin Guy N64 Preview 1.
// Do not attach this to the public arcadeLeaderboard endpoint or set public
// consent for the 662 imported customers on their behalf.
import {getStore} from "@netlify/blobs";
import api from "./lib/squeegeeApiV3.js";
import owner from "./lib/squeegeePreviewTestSession.js";
import customerHQ from "./lib/customerHQ.js";
import consent from "./lib/squeegeeLeaderboardNameConsent.js";
import ranking from "./lib/squeegeeOwnerLeaderboardPreview.js";
import {safePublicTown} from "./lib/arcadePublicIdentity.js";

const responseHeaders={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "Pragma":"no-cache",
  "Vary":"Cookie",
  "X-Content-Type-Options":"nosniff",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "Referrer-Policy":"no-referrer",
};
const json=(status,body)=>new Response(JSON.stringify(body),
  {status,headers:responseHeaders});

function scopeFor(request,context){
  return {hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,
    siteId:context?.site?.id};
}

export default async function handler(request,context){
  // Exact Preview 1 project/hostname only. Production remains untouched.
  const scope=scopeFor(request,context);
  if(!api.isExactPreview1(process.env,scope))
    return json(404,{error:"not_found"});
  if(request.method!=="GET")
    return json(405,{error:"method_not_allowed"});

  // This owner session comes from the existing emailed owner access code.
  // A customer login cookie does NOT authorize the owner leaderboard.
  const cookie=owner.sessionCookieFromHeader(
    request.headers.get("cookie"));
  if(!owner.verifyTestSessionCookie(
    cookie,process.env,Date.now(),scope))
    return json(401,{error:"owner_sign_in_required"});

  try{
    const [history,permissions]=await Promise.all([
      getStore({name:customerHQ.DATA_STORE,consistency:"strong"})
        .get(customerHQ.DATA_KEY,{type:"json",consistency:"strong"}),
      getStore({name:consent.STORE_NAME,consistency:"strong"})
        .get(consent.KEY,{type:"json",consistency:"strong"}),
    ]);
    const eligible=customerHQ.eligibleRankedEmailAccounts(history);
    if(!eligible) return json(409,{error:"verified_history_not_available"});
    const board=ranking.ownerPrivateLeaderboardPreview(
      history,permissions,eligible,Math.max(1,eligible.count));
    if(!board || board.count!==eligible.count ||
       board.rows.length!==eligible.count)
      return json(409,{error:"verified_rankings_not_ready"});

    // Send only the first-name/town/points information the owner requested,
    // plus a separate permission status. No email, ID, surname, Squeegee ref,
    // address, raw private Blob data, or consent evidence reaches the browser.
    const entries=board.rows.map(entry=>({
      rank:entry.rank,
      firstName:consent.safeFirstName(entry.firstName)||null,
      town:safePublicTown(entry.town),
      points:entry.points,
      permission:entry.permission,
    }));
    return json(200,{
      ownerView:true,
      private:true,
      sourceAsOf:history.asOf,
      verifiedPlayers:eligible.count,
      historicalCleaningXp:eligible.historicalPoints,
      publicApprovedCount:board.approved,
      entries,
    });
  }catch{
    // No error logging of imported Squeegee names/identifiers.
    console.warn("Owner leaderboard temporarily unavailable");
    return json(503,{error:"owner_leaderboard_temporarily_unavailable"});
  }
}
export const config={path:"/api/squeegee-preview-verified-leaderboard"};
