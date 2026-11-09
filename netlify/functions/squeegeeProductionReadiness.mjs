// GET-only operational preflight for the *published* NI Bin Guy Squeegee writer.
// Never posts a Squeegee customer/job, queues a booking, or reveals credentials.
// It checks the actual deployed function environment and authenticated API GETs.
import guard from "./lib/squeegeeProductionGuard.js";
import productionApi from "./lib/squeegeeProductionApi.js";

const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});

export default async function handler(request,context){
  const scope={
    hostname:new URL(request.url).hostname,
    deployContext:context?.deploy?.context,
    siteId:context?.site?.id,
  };
  if(!guard.isVerifiedProductionScope(scope))
    return reply(404,{error:"not_found"});
  if(request.method!=="GET")
    return reply(405,{error:"method_not_allowed"});
  if(!guard.productionConfigured(process.env,scope))
    return reply(503,{ready:false,reason:"production_sync_not_ready"});

  try{
    const api=productionApi.createProductionClient({env:process.env,scope});
    // This verifies production credentials and Squeegee connectivity without
    // creating customers, jobs, claims, reservations or outgoing email.
    await Promise.all([api.getServices(),api.getJobGroups()]);
    return reply(200,{ready:true,readOnlyConnectionVerified:true});
  }catch{
    return reply(503,{ready:false,reason:"squeegee_read_only_connection_unavailable"});
  }
}

export const config={
  path:"/api/squeegee-production-readiness",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:12},
};
