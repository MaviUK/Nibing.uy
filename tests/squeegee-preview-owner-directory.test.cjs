"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const directory=require("../netlify/functions/lib/squeegeePreviewOwnerCustomerDirectory");

const sample=[
 {id:"uuid-one",ref:"3024",firstName:"Glen",town:"Bangor",email:"glen@example.test",points:162,
  events:[
   {date:"2024-10-01",event:"paid_completed_clean",quantity:2,points:40,streak:1},
   {date:"2024-10-29",event:"paid_completed_clean",quantity:2,points:44,streak:2},
   {date:"2025-01-02",event:"completed_payment_not_verified",quantity:2,points:0,streak:2},
   {date:"2026-10-21",event:"paid_completed_clean",quantity:3,points:78,streak:4}
  ]},
 {id:"uuid-two",ref:"4100",firstName:"Ronnie",town:"Newtownards",email:"",points:20,
  events:[{date:"2026-02-11",event:"paid_completed_clean",points:20,streak:1},
   {date:"2026-03-11",event:"recorded_skip",points:0,streak:1}]}
];
const aliasForId=id=>id==="uuid-one"?"alias-one":"alias-two";
const eligibleAliases=new Set(["alias-one"]);

test("counts physical-bin quantities, not just jobs, with accurate yearly XP",()=>{
 const all=directory.cleaningSummary(sample[0]);
 assert.equal(all.paidBins,7);
 assert.equal(all.paidVisits,3);
 assert.equal(all.points,162);
 assert.equal(all.unverified,1);
 assert.equal(directory.cleaningSummary(sample[0],2024).points,84);
 assert.equal(directory.cleaningSummary(sample[0],2026).paidBins,3);
});
test("older historical events with no quantity count as one physical clean",()=>{
 const score=directory.cleaningSummary(sample[1]);
 assert.equal(score.paidBins,1);
 assert.equal(score.skips,1);
 assert.equal(score.points,20);
});
test("searches only imported customers by first name, email, town or reference",()=>{
 const options={eligibleAliases,aliasForId};
 for(const search of ["glen","GLEN@EXAMPLE.TEST","ban","3024"]){
  const result=directory.directoryRows(sample,{...options,query:search});
  assert.equal(result.length,1);
  assert.equal(result[0].account.ref,"3024");
 }
 assert.equal(directory.directoryRows(sample,{...options,query:"no-result"}).length,0);
 assert.equal(directory.directoryRows(sample,{...options,query:"4100"})[0].account.ref,"4100");
});
test("eligibility filters exclude accounts without verified leaderboard status",()=>{
 const options={eligibleAliases,aliasForId};
 assert.deepEqual(directory.directoryRows(sample,{...options,mode:"eligible"}).map(r=>r.account.ref),["3024"]);
 assert.deepEqual(directory.directoryRows(sample,{...options,mode:"other"}).map(r=>r.account.ref),["4100"]);
});
test("annual filtering preserves customers with recorded unpaid visits",()=>{
 const options={eligibleAliases,aliasForId,year:2025};
 const rows=directory.directoryRows(sample,options);
 assert.equal(rows.length,1);
 assert.equal(rows[0].account.ref,"3024");
 assert.equal(rows[0].periodPoints,0);
 assert.equal(rows[0].periodBins,0);
});
test("annual breakdown includes every verified event year",()=>{
 assert.deepEqual(directory.yearlyCleaning(sample[0]).map(x=>x.year),[2026,2025,2024]);
});
test("owner directory enforces exact Preview 77 and signed owner cookie before reading data",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../netlify/functions/squeegeePreviewOwnerCustomers.mjs"),"utf8");
 assert.match(source,/api\.isExactPreview1\(process\.env,scope\)/);
 assert.match(source,/owner\.verifyTestSessionCookie\(cookie,process\.env,Date\.now\(\),scope\)/);
 const guarded=source.indexOf("if(!owner.verifyTestSessionCookie");
 const privateRead=source.indexOf("const snapshot=await getStore");
 assert.ok(guarded>=0&&privateRead>guarded);
 assert.match(source,/path:"\/api\/squeegee-preview-owner-customers"/);
 assert.doesNotMatch(source,/path:PATH/);
 assert.match(source,/Content-Security-Policy/);
 assert.match(source,/no-store/);
 assert.doesNotMatch(source,/addJobToCustomer|createCustomer\(/);
});
test("owner email-code return path is explicit and doesn't permit arbitrary URLs",()=>{
 const code=fs.readFileSync(path.join(__dirname,"../netlify/functions/squeegeePreviewTest.mjs"),"utf8");
 assert.match(code,/if\(value==="\/api\/squeegee-preview-owner-customers"\)return value;/);
});
