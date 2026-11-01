"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const names=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const {canonicalLegacyRef}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const staticHistory=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");

const SECRET=crypto.randomBytes(32);
const ids=[
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const a=ids.map(id=>canonicalLegacyRef(id));
const privateData={version:1,asOf:staticHistory.AS_OF,accounts:[
  {id:ids[0],ref:"CUS101",email:"sarah@example.co.uk",firstName:"Sarah",town:"Bangor",points:44},
  {id:ids[1],ref:"CUS102",email:"john@example.co.uk",firstName:"John",town:"Comber",points:22},
  {id:ids[2],ref:"CUS103",email:null,firstName:"Paul",town:"Holywood",points:20}
]};
const board={status:"squeegee_active_only",sourceAsOf:staticHistory.AS_OF,
  lastUpdatedAt:"2026-10-31T23:59:59Z",entries:[
    {customerRef:a[0],town:"Bangor",points:44},
    {customerRef:a[1],town:"Comber",points:22},
    {customerRef:a[2],town:"Holywood",points:20},
  ]};
const permittedAliases=new Set(a.slice(0,2));
const ledger={version:1,sourceAsOf:staticHistory.AS_OF,records:[
  {alias:a[0],firstName:"Sarah",town:"Bangor",consent:"pending"},
  {alias:a[1],firstName:"John",town:"Comber",consent:"pending"},
  {alias:a[2],firstName:"Paul",town:"Holywood",consent:"pending"},
]};
function get(snapshot=privateData,scores=board,allowed=permittedAliases,permissions=ledger){
  return names.previewFirstNameScoreboard(snapshot,scores,allowed,permissions,SECRET);
}
test("preview public leaderboard shows real imported first name, town and XP without login",()=>{
  const result=get();
  assert.equal(result.status,"preview_public_first_names");
  assert.equal(result.totalPlayers,2);
  assert.equal(result.namedCount,2);
  assert.deepEqual(result.entries.map(x=>x.displayName),["Sarah","John"]);
  assert.deepEqual(result.entries.map(x=>x.town),["Bangor","Comber"]);
  assert.deepEqual(result.entries.map(x=>x.points),[44,22]);
  assert.ok(result.entries.every(x=>/^NBG-[A-F0-9]{10}$/.test(x.customerRef)));
  assert.equal(result.entries.some(x=>x.anonymous===true),false);
  const body=JSON.stringify(result);
  for(const privateValue of ["sarah@example.co.uk","john@example.co.uk","CUS101","CUS102",...ids,...a])
    assert.ok(!body.includes(privateValue),"private value leaked: "+privateValue);
  assert.ok(!body.includes("Paul"));
});
test("no-email accounts and explicit withdrawals are excluded from test board",()=>{
  const withdrawn={...ledger,records:[
    {...ledger.records[0],consent:"withdrawn",withdrawnAt:"2026-11-01T15:00:00Z"},
    ledger.records[1],ledger.records[2]
  ]};
  const result=get(privateData,board,permittedAliases,withdrawn);
  assert.equal(result.totalPlayers,1);
  assert.equal(result.entries[0].displayName,"John");
  assert.equal(result.entries[0].points,22);
  assert.equal(result.namedCount,1);
});
test("private customer import, eligibility and owner secret required",()=>{
  assert.equal(get(null),null);
  assert.equal(get(privateData,board,null),null);
  assert.equal(names.previewFirstNameScoreboard(privateData,board,permittedAliases,ledger,null),null);
  assert.equal(get(privateData,{...board,sourceAsOf:"2021-01-01"}),null);
  const stale=get(privateData,{...board,status:"active_status_refresh_required"});
  assert.equal(stale.totalPlayers,0);
  assert.deepEqual(stale.entries,[]);
  assert.equal(stale.status,"active_status_refresh_required");
});
test("public name display is only connected to the exact N64 preview host",()=>{
  const root=path.resolve(__dirname,"..");
  const source=fs.readFileSync(path.join(root,"netlify/functions/arcadeLeaderboard.js"),"utf8");
  const ui=fs.readFileSync(path.join(root,"src/components/ArcadeLeaderboard.jsx"),"utf8");
  assert.match(source,/host==="deploy-preview-77--nibinguy\.netlify\.app"/);
  const start=source.indexOf("if(isExactN64PreviewRequest(event)){");
  const call=source.indexOf("nameConsents.previewFirstNameScoreboard(");
  const prod=source.indexOf("const activeBoard=await getActiveHistoricalBoard(stores)");
  assert.ok(start>=0&&call>start&&prod>call);
  assert.match(source,/preview_public_first_names/);
  assert.match(ui,/data\.status==="preview_public_first_names"/);
  assert.doesNotMatch(ui,/Everyone can see the N64 test leaderboard by first name, town and points/);
  assert.match(ui,/SHOW MORE PUBLIC SCORES/);
  assert.match(ui,/<CustomerHQ embedded/);
});
