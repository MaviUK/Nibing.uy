"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"public/customer-hq-import-validation.js"),"utf8");
const handler=fs.readFileSync(path.join(root,"netlify/functions/squeegeePreviewCustomerHQImport.mjs"),"utf8");

function simulateUpload(file) {
  const formListeners={},inputListeners={};
  const status={textContent:"",focusCalled:false,
    setAttribute(key,value){this[key]=value;},
    focus(){this.focusCalled=true;}};
  const form={addEventListener(name,cb){formListeners[name]=cb;}};
  const field={files:file?[file]:[],addEventListener(name,cb){inputListeners[name]=cb;}};
  const document={readyState:"complete",getElementById(id){
    return ({"hq-history-upload-form":form,"hq-history-file":field,
      "hq-upload-error":status})[id]||null;
  }};
  vm.runInNewContext(source,{document},{timeout:1000});
  assert.equal(typeof formListeners.submit,"function");
  let prevented=false;
  formListeners.submit({preventDefault(){prevented=true;}});
  return {prevented,message:status.textContent,focused:status.focusCalled};
}

test("Android owner uploader blocks the original Squeegee archive before the POST",()=>{
  const result=simulateUpload({name:"backup-manual-2026-11-06-18-50-41.sqg",size:30853639});
  assert.equal(result.prevented,true);
  assert.equal(result.focused,true);
  assert.match(result.message,/Squeegee \.sqg backup/);
  assert.match(result.message,/Customer HQ JSON/);
});

test("Android owner uploader blocks oversized or empty JSON but permits the 2.3 MB prepared import",()=>{
  const oversized=simulateUpload({name:"oversized.json",size:3900000});
  assert.equal(oversized.prevented,true);
  assert.match(oversized.message,/too large/);
  const empty=simulateUpload({name:"empty.json",size:2});
  assert.equal(empty.prevented,true);
  const permitted=simulateUpload({
    name:"NI_Bin_Guy_Customer_HQ_Secure_Import_PRIVATE_2026-11-05_PER_BIN.json",
    size:2306345,
  });
  assert.equal(permitted.prevented,false);
  assert.equal(permitted.message,"");
});

test("private import keeps owner OTP and CSRF, caps multipart, and rejects non-JSON on the server",()=>{
  assert.match(handler,/verifyTestSessionCookie/);
  assert.match(handler,/uploadCsrf\.isAllowedOwnerUpload/);
  assert.match(handler,/4_200_000/);
  assert.match(handler,/3_800_000/);
  assert.match(handler,/if\(typeof file\.name!=="string"/);
  assert.match(handler,/status:404|status:405|415/);
  assert.ok(handler.includes('accept=".sqg,application/octet-stream,.json,application/json"'));
  assert.ok(handler.includes("customer-hq-sqg-import.mjs"));
  assert.match(handler,/script-src 'self'/);
  assert.doesNotMatch(handler,/script-src 'unsafe-inline'/);
  assert.doesNotMatch(handler,/file\.arrayBuffer\(/);
});
