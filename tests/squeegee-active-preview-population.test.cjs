"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");
const staticHistory=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");
const active=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const {getStaticPreviewBoard}=require("../netlify/functions/lib/squeegeeActivePreviewBoard");
const NOW=Date.parse("2026-11-01T12:00:00Z");

function fakeStores(links=[],players=new Map()){
  const byKey=new Map(links);
  return {
    links:{
      list:async()=>({blobs:[...byKey.keys()].map(key=>({key}))}),
      get:async key=>byKey.get(key)||null,
    },
    public:{get:async key=>players.get(key)||null},
  };
}
test("source is 941 pseudonymous active accounts, 808,316 streak points, 11 towns",()=>{
  assert.equal(staticHistory.AS_OF,"2026-10-31");
  assert.equal(staticHistory.ENTRIES.length,941);
  assert.equal(staticHistory.ENTRIES.reduce((n,entry)=>n+entry[2],0),808316);
  assert.equal(staticHistory.SCORING_VERSION,"2026-11-streak-20-plus-2-squeegee-skip-reset-v1");
  assert.equal(new Set(staticHistory.ENTRIES.map(row=>row[0])).size,941);
  assert.equal(new Set(staticHistory.ENTRIES.map(row=>row[1])).size,11);
  for(const [ref,town,points] of staticHistory.ENTRIES){
    assert.match(ref,/^NBG-[A-F0-9]{10}$/);
    assert.equal(town,require("../netlify/functions/lib/arcadePublicIdentity").safePublicTown(town));
    assert.ok(Number.isSafeInteger(points)&&points>0);
  }
  const source=JSON.stringify(staticHistory.ENTRIES);
  assert.ok(!/\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\b/i.test(source));
  assert.ok(!/email|postcode|invoice|customerid|phone|address/i.test(source));
});

test("static board shows the actual Top 10 and 941 people, not unrelated website players",async()=>{
  const board=await getStaticPreviewBoard(fakeStores(),NOW);
  assert.equal(board.status,"squeegee_active_only");
  assert.equal(board.sourceAsOf,"2026-10-31");
  assert.equal(board.totalPlayers,941);
  assert.equal(board.entries.length,10);
  assert.equal(board.entries[0].points,6738);
  assert.ok(board.entries.every(x=>/^NBG-[A-F0-9]{10}$/.test(x.customerRef)));
  assert.ok(!JSON.stringify(board).includes("squeegeeId"));
});

test("confirmed website XP adds ONCE; duplicate linked players contribute zero XP",async()=>{
  const keyA="player:"+"a".repeat(64);
  const keyB="player:"+"b".repeat(64);
  const id="12345678-1234-4123-8123-123456789abc";
  const target=staticHistory.ENTRIES[0][0];
  const old=active.canonicalLegacyRef;
  active.canonicalLegacyRef=(uuid)=>uuid===id?target:null;
  try {
    const single=fakeStores([[keyA,{squeegeeId:id,verified:true}]],
      new Map([[keyA,{points:550}]]));
    const board=await getStaticPreviewBoard(single,NOW);
    assert.equal(board.totalPlayers,941);
    assert.equal(board.entries[0].customerRef,target);
    assert.equal(board.entries[0].points,7288);

    // A customer with two website profiles cannot collect two XP balances.
    const double=fakeStores([
      [keyA,{squeegeeId:id,verified:true}],
      [keyB,{squeegeeId:id,verified:true}]
    ],new Map([[keyA,{points:550}],[keyB,{points:300}]]));
    const collided=await getStaticPreviewBoard(double,NOW);
    assert.equal(collided.entries[0].customerRef,target);
    assert.equal(collided.entries[0].points,6738);

    const unverified=fakeStores([[keyA,{squeegeeId:id,verified:false}]],
      new Map([[keyA,{points:550}]]));
    assert.equal((await getStaticPreviewBoard(unverified,NOW)).entries[0].points,6738);
  } finally {
    active.canonicalLegacyRef=old;
  }
});

test("backup expiry hides stale active accounts, not just a dated label",async()=>{
  assert.equal(staticHistory.getHistoricalSnapshot(NOW).totalPlayers,941);
  const expired=await getStaticPreviewBoard(fakeStores(),
    Date.parse("2026-11-10T10:00:00Z"));
  assert.equal(expired.totalPlayers,0);
  assert.deepEqual(expired.entries,[]);
  assert.equal(expired.status,"active_status_refresh_required");
});

test("website endpoint blocks all historical entries until private email eligibility import on preview 77",async()=>{
  const original=Module._load;
  const realNow=Date.now;
  Date.now=()=>NOW; // test is independent of the real seven-day snapshot expiry
  const noopStore={
    get:async()=>null,
    list:async()=>({blobs:[]}),
    delete:async()=>{},
    setJSON:async()=>({modified:true,etag:'"test"'}),
  };
  Module._load=function(name,parent,isMain){
    if(name==="@netlify/blobs")return {
      getStore:()=>noopStore,
    };
    return original.call(this,name,parent,isMain);
  };
  try{
    delete require.cache[require.resolve("../netlify/functions/arcadeLeaderboard")];
    const api=require("../netlify/functions/arcadeLeaderboard");
    const preview=await api.handler({httpMethod:"GET",headers:{
      host:"deploy-preview-77--nibinguy.netlify.app"
    }});
    assert.equal(preview.statusCode,200);
    const board=JSON.parse(preview.body);
    assert.equal(board.totalPlayers,0);
    assert.deepEqual(board.entries,[]);
    assert.equal(board.status,"eligibility_pending");
    assert.ok(!preview.body.includes("squeegeeId"));
    const production=await api.handler({httpMethod:"GET",headers:{
      host:"nibing.uy"
    }});
    assert.equal(production.statusCode,200);
    assert.equal(JSON.parse(production.body).totalPlayers,0);
  }finally{
    Module._load=original;
    Date.now=realNow;
    delete require.cache[require.resolve("../netlify/functions/arcadeLeaderboard")];
  }
});
