"use strict";

/**
 * Isolated production Squeegee client. NOT called from the preview worker.
 * Production requires a trusted Netlify runtime context, separate secret,
 * explicit owner/ledger/kill-switch flags, and an acquired CAS booking proof
 * for every POST. No browser-facing function uses this module directly.
 */
const {AsyncLocalStorage}=require("node:async_hooks");
const production=require("./squeegeeProductionGuard");
const {requireUuid,SqueegeeApiError}=require("./squeegeeApiV3");

const API_ORIGIN="https://api02.sqgee.com";
const PREFIX="/api/v3/public";
const writer=new AsyncLocalStorage();

function createProductionClient({env=process.env,scope=null,fetchImpl=globalThis.fetch}={}) {
  const allowed=()=>production.productionConfigured(env,scope);
  const request=async(method,path,{query,body,timeoutMs=15000}={})=>{
    if(!allowed())throw new Error("Production Squeegee API disabled");
    if(!["GET","POST"].includes(method) ||
       typeof path!=="string" || !path.startsWith(PREFIX+"/") ||
       path.includes("..") || /[?#]/.test(path))
      throw new Error("Unsupported Squeegee API request");
    if(method==="POST" &&
       !(writer.getStore()?.authorized===true &&
         writer.getStore().scope===scope &&
         allowed()))
      throw new Error("Production Squeegee write not authorised");
    const url=new URL(path,API_ORIGIN);
    for(const [key,value] of Object.entries(query||{})){
      if(value!==undefined && value!==null && value!=="")
        url.searchParams.set(key,String(value));
    }
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(url,{
        method,
        headers:{
          Authorization:"Bearer "+env.SQUEEGEE_PRODUCTION_API_KEY.trim(),
          "Content-Type":"application/json",Accept:"application/json",
        },
        body:method==="POST"?JSON.stringify(body):undefined,
        signal:controller.signal,redirect:"error",
      });
      const payload=await response.json().catch(()=>null);
      if(!response.ok || !payload || payload.success!==true)
        throw new SqueegeeApiError("Squeegee returned unsuccessful response",
          response.status,Number.isInteger(payload?.code)?payload.code:null);
      return payload;
    }catch(error){
      if(error?.name==="AbortError")
        throw new SqueegeeApiError("Squeegee timed out",0);
      throw error;
    }finally{clearTimeout(timer);}
  };
  const withWrite=(proof,operation,runtimeScope,workerEnv=env)=>{
    if(runtimeScope!==scope || workerEnv!==env ||
       !production.productionWriteAdmission({env,scope,proof}) ||
       typeof operation!=="function")
      throw new Error("Production Squeegee write capability unavailable");
    return writer.run({authorized:true,scope,claimKey:proof.key},operation);
  };
  return Object.freeze({
    getServices:async({description}={})=>
      (await request("GET",PREFIX+"/services",{query:{description}})).data,
    getJobGroups:async({description}={})=>
      (await request("GET",PREFIX+"/job-groups",{query:{description}})).data,
    listCustomers:async({page=1,pagedRequestId}={})=>{
      if(!Number.isInteger(page)||page<1)throw new Error("Invalid page");
      return (await request("GET",PREFIX+"/customers",
        {query:{page,pagedRequestId}})).data;
    },
    getCustomer:async id=>
      (await request("GET",PREFIX+"/customers/"+requireUuid(id,"customerId"))).data,
    createCustomer:async input=>
      (await request("POST",PREFIX+"/customers",{body:input})).data,
    addJobToCustomer:async(id,input)=>
      request("POST",PREFIX+"/customers/"+requireUuid(id,"customerId")+"/jobs",
        {body:input}),
    withWrite,
  });
}

module.exports={createProductionClient};
