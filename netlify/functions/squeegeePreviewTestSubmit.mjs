// PREVIEW 1 ONLY — dispatch exactly one owner-authenticated, confirmed
// booking to a post-response worker. No arbitrary customer creation endpoint.
import api from "./lib/squeegeeApiV3.js";
import testSession from "./lib/squeegeePreviewTestSession.js";
import controlled from "./lib/squeegeeOneBookingTest.js";
import arcade from "./lib/arcadeBookingProof.js";

const json=(status,data)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json; charset=utf-8",
    "cache-control":"no-store","x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer"},
});
const runtimeScope=(request,context)=>({
  hostname:new URL(request.url).hostname,
  deployContext:context?.deploy?.context,
  siteId:context?.site?.id,
});
function matchesAcceptedBooking(payload,signed) {
  if(!signed || !payload || typeof payload!=="object")return false;
  if(String(payload.bookingId||"")!==String(signed.id||"") ||
     String(payload.name||"").trim()!==String(signed.name||"").trim() ||
     String(payload.email||"").trim().toLowerCase()!==String(signed.email||"").trim().toLowerCase() ||
     String(payload.address||"").trim()!==String(signed.address||"").trim() ||
     String(payload.phone||"").trim()!==String(signed.phone||"").trim())return false;
  if(!Array.isArray(payload.bins) || payload.bins.length!==1 ||
     !Array.isArray(signed.bins) || signed.bins.length!==1)return false;
  const a=payload.bins[0],b=signed.bins[0];
  return String(a?.type||"")===String(b?.type||"") &&
    String(a?.planId||"")===String(b?.planId||"") &&
    Number(a?.count)===Number(b?.count);
}
export default async function handler(request,context) {
  const scope=runtimeScope(request,context);
  if(!api.isExactPreview1(process.env,scope) ||
     !process.env.SQUEEGEE_API_KEY) return json(404,{error:"Not found"});
  if(request.method!=="POST")return json(405,{error:"Method not allowed"});
  const token=testSession.sessionCookieFromHeader(request.headers.get("cookie"));
  if(!testSession.verifyTestSessionCookie(token,process.env,Date.now(),scope)) {
    return json(403,{error:"Owner test authorization required"});
  }
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(415,{error:"JSON required"});
  }
  let body;
  try {
    const raw=await request.text();
    if(raw.length>30000) return json(413,{error:"Test payload too large"});
    body=JSON.parse(raw);
  } catch {return json(400,{error:"Malformed test submission"});}
  const payload=body?.booking;
  const proof=arcade.verifyBooking(body?.bookingProof);
  if(!matchesAcceptedBooking(payload,proof)) {
    return json(403,{error:"An accepted, server-signed booking is required"});
  }
  const eligible=controlled.isEligibleOneBooking(payload);
  if(!eligible.eligible) {
    return json(422,{error:"Only one domestic four-weekly bin is allowed in the test",
      reason:eligible.reason});
  }
  if(typeof context?.waitUntil!=="function") {
    return json(503,{error:"Reliable post-response processing unavailable"});
  }
  // No Squeegee POST is attempted here. The worker revalidates the display
  // against council schedule and API account service/group IDs, scans all
  // customers, then performs a global atomic one-use claim. Its write
  // capability is scoped to THIS trusted deploy context.
  const task=controlled.executeOneApprovedTestBooking(payload,{
    cookieHeader:request.headers.get("cookie")||"",
    channel:"email",runtimeScope:scope,
  }).catch(()=>({status:"requires_reconciliation"}));
  context.waitUntil(task);
  return json(202,{accepted:true,queued:true,bookingId:eligible.bookingId,
    message:"One-booking Squeegee test queued. Check owner test page for result."});
}
export const config={
  path:"/api/squeegee-preview-test-submit",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:10},
};
