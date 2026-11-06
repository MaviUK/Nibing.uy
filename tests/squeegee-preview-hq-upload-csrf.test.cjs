"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {IMPORT_ORIGIN,tokenForOwnerSession,isAllowedOwnerUpload}=
  require("../netlify/functions/lib/squeegeePreviewHQImportCsrf");

const env={SQUEEGEE_API_KEY:"privately-configured-test-secret-0123456789"};
const cookie="1762000000000."+"f".repeat(32)+"."+"c".repeat(64);
const token=tokenForOwnerSession(cookie,env);
function attempt(values={}){
  return isAllowedOwnerUpload({
    cookie,token,env,
    headers:new Headers(values),
  });
}
test("Owner upload requires a secret bound to exact owner session",()=>{
  assert.match(token,/^[0-9a-f]{64}$/);
  assert.equal(tokenForOwnerSession(cookie,{SQUEEGEE_API_KEY:""}),null);
  assert.equal(isAllowedOwnerUpload({
    cookie:cookie+"extra",token,env,headers:new Headers(),
  }),false);
  assert.equal(isAllowedOwnerUpload({
    cookie,token:token.slice(0,-2)+"aa",env,headers:new Headers(),
  }),false);
  assert.equal(isAllowedOwnerUpload({
    cookie,token:null,env,headers:new Headers(),
  }),false);
});
test("Ordinary same-origin upload succeeds on desktop and Android browser",()=>{
  assert.equal(attempt({Origin:IMPORT_ORIGIN,"Sec-Fetch-Site":"same-origin"}),true);
  // A Samsung/ChatGPT in-app browser can send an absent or null Origin.
  assert.equal(attempt(),true);
  assert.equal(attempt({Origin:"null"}),true);
  assert.equal(attempt({Referer:IMPORT_ORIGIN+"/api/squeegee-preview-hq-import"}),true);
  assert.equal(attempt({Origin:"null",Referer:IMPORT_ORIGIN+"/"}),true);
});
test("Foreign origins and malicious cross-site form submissions are blocked",()=>{
  assert.equal(attempt({Origin:"https://evil.example"}),false);
  assert.equal(attempt({"Sec-Fetch-Site":"cross-site"}),false);
  assert.equal(attempt({Origin:"null","Sec-Fetch-Site":"cross-site"}),false);
  assert.equal(attempt({Referer:"https://evil.example/"}),false);
  assert.equal(attempt({Referer:"not-a-url"}),false);
  assert.equal(attempt({Origin:IMPORT_ORIGIN+".evil.example"}),false);
});
test("Only the private owner import form can carry the session-bound token",()=>{
  const ownerForm=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewCustomerHQImport.mjs"),"utf8");
  assert.match(ownerForm,/name="csrf"/);
  assert.match(ownerForm,/uploadCsrf\.isAllowedOwnerUpload/);
  assert.ok(!ownerForm.includes('request.headers.get("origin")!==HOST'));
  assert.ok(ownerForm.includes('session.verifyTestSessionCookie'));
  assert.ok(!ownerForm.includes("file.arrayBuffer()")); // avoid unbounded binary handling
  assert.ok(ownerForm.includes("3_500_000")); // multipart size cap
});
