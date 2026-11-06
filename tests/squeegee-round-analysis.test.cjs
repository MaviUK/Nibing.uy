"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const { analyzeSqueegeeTownGroups, townFromAddress, groupIdFromJob }=require("../netlify/functions/lib/squeegeeRoundAnalysis");
const a="11111111-1111-4111-8111-111111111111";
const b="22222222-2222-4222-8222-222222222222";
const groups=[{id:a,description:"01"},{id:b,description:"09"}];
function customer(i, town, group, extra={}) {
 return {
  _id:"customer-"+i,
  address:{addressDescription:String(i+1)+" Sample Street, "+town+", BT20 4AA"},
  jobs:[{_id:"job-"+i,jobGroup:group}, { _id:"job2-"+i,jobGroup:group }],
  ...extra
 };
}
test("recognizes the covered town in nested Squeegee addressDescription",()=>{
 assert.equal(townFromAddress("17 Example Road, Bangor BT20 4AA"),"Bangor");
 assert.equal(townFromAddress("5 Road, Newtownards BT23 3EE"),"Newtownards");
 assert.equal(townFromAddress("5 Road, Ballywalter BT22 2EE"),null);
 assert.equal(townFromAddress("Bangor Holywood Road BT19"),null);
});
test("extracts Squeegee group IDs from string or nested object",()=>{
 assert.equal(groupIdFromJob({jobGroup:a}),a);
 assert.equal(groupIdFromJob({jobGroup:{id:b}}),b);
 assert.equal(groupIdFromJob({jobGroup:{_id:b}}),b);
 assert.equal(groupIdFromJob({jobGroup:null}),"");
});
test("aggregate counts unique customers not three bins per property",()=>{
 const rows=Array.from({length:12},(_,i)=>customer(i,"Bangor",a));
 const out=analyzeSqueegeeTownGroups(groups,rows);
 assert.equal(out.groupsScanned,2);
 assert.equal(out.groups[0].classifiedCustomers,12);
 assert.equal(out.groups[0].towns[0].customers,12);
 assert.equal(out.groups[0].suggestedTown,"Bangor");
 assert.equal(out.groups[0].suggestedTownShare,100);
 assert.equal(out.groups[1].suggestedTown,null);
 assert.equal(out.customerGroupAssignments,12);
});
test("mixed-town group isn't declared a single-town mapping",()=>{
 const rows=[
  ...Array.from({length:8},(_,i)=>customer(i,"Bangor",a)),
  ...Array.from({length:6},(_,i)=>customer(i+10,"Holywood",a))
 ];
 const out=analyzeSqueegeeTownGroups(groups,rows);
 assert.equal(out.groups[0].suggestedTown,null);
 assert.deepEqual(out.groups[0].towns,[{town:"Bangor",customers:8},{town:"Holywood",customers:6}]);
});
test("small populations are suppressed to protect individual customers",()=>{
 const out=analyzeSqueegeeTownGroups(groups,[
  customer(1,"Carrowdore",a),
  customer(2,"Carrowdore",a),
  customer(3,"Carrowdore",a),
 ]);
 assert.equal(out.groups[0].classifiedCustomers,3);
 assert.deepEqual(out.groups[0].towns,[]);
 assert.equal(out.groups[0].suggestedTown,null);
 assert.equal(JSON.stringify(out).includes("Sample Street"),false);
 assert.equal(JSON.stringify(out).includes("_id"),false);
});
test("unknown group IDs aren't silently mapped to another round",()=>{
 const out=analyzeSqueegeeTownGroups(groups,[customer(1,"Bangor","other")]);
 assert.equal(out.unresolvedGroupAssignments,1);
 assert.equal(out.customerGroupAssignments,0);
});
