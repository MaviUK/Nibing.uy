"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const file=name=>fs.readFileSync(path.join(root,name),"utf8");
test("private owner imports report only safe error codes after owner OTP and CSRF",()=>{
  const s=file("netlify/functions/squeegeePreviewCustomerHQImport.mjs");
  assert.match(s,/const OWNER_IMPORT_CODES=new Set/);
  assert.match(s,/OWNER_IMPORT_CODES\.has\(code\)\?code:"unexpected_failure"/);
  assert.match(s,/console\.warn\("preview77_private_hq_import_rejected",safeStage,reason\)/);
  assert.match(s,/const validated=hq\.validateSource\(parsed\)/);
  assert.match(s,/stage="verify_history"/);
  assert.match(s,/stage="prepare_consents"/);
  assert.match(s,/X-Private-Import-Reason/);
  assert.match(s,/return importFailure\(stage,error\)/);
  assert.match(s,/session\.verifyTestSessionCookie/);
  assert.match(s,/uploadCsrf\.isAllowedOwnerUpload/);
  assert.doesNotMatch(s,/console\.(?:log|info|warn)\([^)]*source[,) ]/);
});
test("Android import error displays only human-readable HTML section, never raw CSS",()=>{
 const s=file("public/customer-hq-sqg-import.mjs");
 assert.match(s,/new DOMParser\(\)\.parseFromString\(reply,"text\/html"\)/);
 assert.match(s,/doc\.querySelector\("main section"\)\?\.textContent/);
 assert.match(s,/privateErrorText\(reply,response\)/);
 assert.doesNotMatch(s,/reply\.replace\(\/<\[\^>\]\*>\//);
});
test("Android browser cannot post an obsolete customer-wide scoring snapshot",()=>{
 const s=file("public/customer-hq-sqg-import.mjs");
 const worker=file("public/customer-hq-sqg-worker.mjs");
 const expected="2026-11-streak-20-plus-1-per-job-per-paid-bin-v3";
 assert.ok(s.includes('scoringVersion!=="'+expected+'"'));
 assert.ok(worker.includes('SCORE_VERSION!=="'+expected+'"'));
 assert.ok(s.includes("customer-hq-sqg-worker.mjs?v=streak-plus1-v3-20261108"));
 assert.ok(worker.includes("customer-hq-sqg-converter.mjs?v=streak-plus1-v3-20261108"));
 const headers=file("public/_headers");
 for(const asset of ["import","worker","converter"]){
  assert.ok(headers.includes("/customer-hq-sqg-"+asset+".mjs\n  Cache-Control: no-store"));
 }
 const page=file("netlify/functions/squeegeePreviewCustomerHQImport.mjs");
 assert.ok(page.includes("customer-hq-sqg-import.mjs?v=streak-plus1-v3-20261108"));
});
