"use strict";
// GitHub Actions OIDC verifier for a SINGLE preview-only, approved API test.
const { createPublicKey, verify }=require("node:crypto");
const ISSUER="https://token.actions.githubusercontent.com";
const AUDIENCE="ni-bin-guy-squeegee-preview77-test-20261030";
const REPOSITORY="MaviUK/Nibing.uy";
const REF="refs/heads/preview/n64-retro-site";
const WORKFLOW_REF=REPOSITORY+"/.github/workflows/squeegee-controlled-test.yml@"+REF;
function parseJwt(token){
 if(typeof token!=="string"||token.length<100||token.length>12000) throw Error("Invalid JWT length");
 const parts=token.split(".");
 if(parts.length!==3||parts.some(x=>!/^[A-Za-z0-9_-]+$/.test(x)))throw Error("Invalid JWT segments");
 try{
  const header=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));
  const claims=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8"));
  if(header.alg!=="RS256"||typeof header.kid!=="string"||header.kid.length>150)throw Error("Unexpected JWT signing method");
  return {header,claims,signed:parts[0]+"."+parts[1],signature:Buffer.from(parts[2],"base64url")};
 }catch{throw Error("Invalid JWT payload or algorithm");}
}
function assertClaims(claims,now=Date.now()){
 const t=Math.floor(now/1000);
 if(claims.iss!==ISSUER||claims.aud!==AUDIENCE||
    claims.repository!==REPOSITORY||claims.ref!==REF||
    claims.workflow_ref!==WORKFLOW_REF||
    claims.workflow!=="Squeegee controlled test booking (preview only)"||
    claims.event_name!=="push"||String(claims.run_attempt)!=="1"||
    !/^\d+$/.test(String(claims.run_id))||
    !Number.isInteger(claims.iat)||!Number.isInteger(claims.nbf)||
    !Number.isInteger(claims.exp)||
    claims.iat<t-300||claims.iat>t+30||
    claims.nbf>t+30||claims.exp<t-30||claims.exp>t+900){
   throw Error("OIDC identity check failed");
 }
 return true;
}
async function getJson(url,fetchImpl){
 const r=await fetchImpl(url,{headers:{Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error("OIDC key fetch failed");
 return r.json();
}
async function verifyIdentity(authorization,{fetchImpl=global.fetch,now=Date.now()}={}){
 const match=String(authorization||"").match(/^Bearer\s+([A-Za-z0-9_.-]+)$/i);
 if(!match)throw Error("GitHub OIDC Bearer required");
 const jwt=parseJwt(match[1]);
 assertClaims(jwt.claims,now);
 const discovery=await getJson(ISSUER+"/.well-known/openid-configuration",fetchImpl);
 if(discovery.issuer!==ISSUER)throw Error("OIDC issuer mismatch");
 const uri=new URL(discovery.jwks_uri);
 if(uri.protocol!=="https:"||uri.hostname!=="token.actions.githubusercontent.com"||
    !uri.pathname.startsWith("/.well-known/")||uri.username||uri.password){
   throw Error("OIDC JWKS URL rejected");
 }
 const keys=await getJson(uri.href,fetchImpl);
 const jwk=keys?.keys?.find(k=>k.kty==="RSA"&&k.kid===jwt.header.kid&&
     (!k.use||k.use==="sig")&&(!k.alg||k.alg==="RS256"));
 if(!jwk)throw Error("OIDC signing key not found");
 const key=createPublicKey({key:jwk,format:"jwk"});
 if(!verify("RSA-SHA256",Buffer.from(jwt.signed),key,jwt.signature)){
   throw Error("OIDC signature rejected");
 }
 return {runId:String(jwt.claims.run_id),repository:jwt.claims.repository};
}
module.exports={ISSUER,AUDIENCE,REF,WORKFLOW_REF,parseJwt,assertClaims,verifyIdentity};