// One-time, strictly read-only Preview 1 deployment readiness check.
// Returns boolean feature flags only, NO environment values, secrets or PII.
import api from "./lib/squeegeeApiV3.js";
import session from "./lib/squeegeePreviewTestSession.js";
export default async function handler(request,ctx) {
  const url=new URL(request.url);
  if(url.hostname!=="deploy-preview-77--nibinguy.netlify.app" ||
    ctx?.deploy?.context!=="deploy-preview" ||request.method!=="GET")
      return new Response("Not found",{status:404});
  const checks={
    context:process.env.CONTEXT==="deploy-preview",
    reviewId:process.env.REVIEW_ID==="77",
    branch:process.env.BRANCH==="preview/n64-retro-site",
    primeUrl:process.env.DEPLOY_PRIME_URL==="https://deploy-preview-77--nibinguy.netlify.app",
    apiKeyAvailable:typeof process.env.SQUEEGEE_API_KEY==="string" &&
      process.env.SQUEEGEE_API_KEY.length>=20,
    resendAvailable:typeof process.env.RESEND_API_KEY==="string" &&
      process.env.RESEND_API_KEY.length>=20,
    strictPreviewGate:api.isExactPreview1(),
    ownerAccessGate:session.validScope(),
    modernContextWaitUntil:typeof ctx.waitUntil==="function",
    modernSiteIdPresent:Boolean(ctx.site?.id),
    modernScopeValid:api.isExactPreview1(process.env,{
      hostname:url.hostname,
      deployContext:ctx.deploy?.context,
      siteId:ctx.site?.id,
    }),
    modernOwnerAccessGate:session.validScope(process.env,{
      hostname:url.hostname,
      deployContext:ctx.deploy?.context,
      siteId:ctx.site?.id,
    }),
    leaderboardProofSecretAvailable:Boolean(process.env.N64_PREVIEW_LEADERBOARD_SECRET),
  };
  // The legacy booking handler calls getContext(). Test whether it is
  // available when invoked from this modern handler, without scheduling work.
  try {
    const {createRequire}=await import("node:module");
    const req=createRequire(import.meta.url);
    const helper=req("@netlify/functions");
    checks.legacyContextModuleAvailable=typeof helper.getContext==="function";
    if(checks.legacyContextModuleAvailable){
      checks.legacyGetContextWorks=typeof helper.getContext()?.waitUntil==="function";
    }
  } catch {
    checks.legacyContextModuleAvailable=false;
    checks.legacyGetContextWorks=false;
  }
  return new Response(JSON.stringify({readOnly:true,checks}),{
    headers:{"content-type":"application/json","cache-control":"no-store",
      "x-content-type-options":"nosniff"},
  });
}
