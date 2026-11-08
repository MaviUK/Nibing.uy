// Temporary release-only atomic-ledger probe. No customer data, no
// Squeegee operations, and no operational booking claims are touched.
// Only runs on the exact production site while Squeegee writes are paused.
import production from "./lib/squeegeeProductionGuard.js";
import { getStore } from "@netlify/blobs";

const output=(status,body)=>new Response(JSON.stringify(body),{
  status,headers:{"Content-Type":"application/json","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff"},
});
const PROBE_KEY="probe-v2/2026-11-08-live-cas";
const PASS_KEY="probe-v2/2026-11-08-live-cas-passed";

export default async function handler(request,context) {
  let hostname;
  try{hostname=new URL(request.url).hostname;}catch{return output(404,{passed:false});}
  const scope={
    hostname,deployContext:context?.deploy?.context,siteId:context?.site?.id,
  };
  if(!production.isVerifiedProductionScope(scope))
    return output(404,{passed:false});
  if(request.method!=="GET")return output(405,{passed:false});
  // Fail closed: never probe while customer writes might be active.
  if(process.env.SQUEEGEE_PRODUCTION_WRITES_PAUSED!=="true" ||
     process.env.SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY!=="false" ||
     process.env.SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES!=="true" ||
     process.env.SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED!=="true")
    return output(423,{passed:false});
  try{
    const store=getStore({name:"nibinguy-production-cas-preflight",
      consistency:"strong"});
    const previous=await store.get(PASS_KEY,{type:"json",
      consistency:"strong"});
    if(previous?.passed===true)return output(200,{passed:true,repeated:true});
    // One immutable test key; requests cannot generate unbounded storage.
    const first=await store.setJSON(PROBE_KEY,{step:"reserved"},
      {onlyIfNew:true});
    if(first?.modified!==true || !first.etag)
      return output(409,{passed:false,stage:"reservation_not_acquired"});
    const duplicate=await store.setJSON(PROBE_KEY,{step:"not_allowed"},
      {onlyIfNew:true});
    if(duplicate?.modified===true){
      let value="unavailable";
      try{
        const readback=await store.get(PROBE_KEY,{
          type:"json",consistency:"strong"});
        value=readback?.step==="not_allowed"?"overwritten":
          readback?.step==="reserved"?"unchanged":"other";
      }catch{}
      return output(503,{passed:false,
        stage:duplicate?.etag?"duplicate_create_committed":"duplicate_create_uncertain",
        readback:value});
    }
    const update=await store.setJSON(PROBE_KEY,{step:"updated"},
      {onlyIfMatch:first.etag});
    if(update?.modified!==true || !update.etag)
      return output(503,{passed:false,stage:"matching_etag_rejected"});
    const stale=await store.setJSON(PROBE_KEY,{step:"not_allowed"},
      {onlyIfMatch:first.etag});
    if(stale?.modified===true)
      return output(503,{passed:false,stage:"stale_etag_allowed"});
    const saved=await store.get(PROBE_KEY,{type:"json",consistency:"strong"});
    if(saved?.step!=="updated")
      return output(503,{passed:false,stage:"readback_wrong"});
    const proof=await store.setJSON(PASS_KEY,{passed:true},
      {onlyIfNew:true});
    if(proof?.modified!==true || !proof?.etag)
      return output(503,{passed:false,stage:"proof_not_saved"});
    console.info("Production CAS release preflight PASS (synthetic data only)");
    return output(200,{passed:true,repeated:false});
  }catch{
    console.error("Production CAS release preflight FAILED");
    return output(503,{passed:false,stage:"storage_error"});
  }
}
export const config={
  path:"/api/squeegee-production-preflight",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:10},
};
