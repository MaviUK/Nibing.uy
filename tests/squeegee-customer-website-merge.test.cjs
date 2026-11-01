"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const merge=require("../netlify/functions/lib/arcadeCustomerMerge");
const board=require("../netlify/functions/lib/squeegeeActivePreviewBoard");
const history=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");
const active=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const UUID="12345678-1234-4123-8123-123456789abc";
const OTHER="abcdefab-2222-4222-8222-abcdefabcdef";
const EMAIL="alex@example.co.uk";
const playerKey="player:"+crypto.createHash("sha256").update(EMAIL).digest("hex");
const NOW=Date.parse("2026-11-01T15:00:00Z");
function store(initial=[]){
  const rows=new Map(initial);
  const tags=new Map();
  let seq=0;
  return {
    rows,
    async get(key){return rows.get(key)||null;},
    async list({prefix}={}){return {blobs:[...rows.keys()]
      .filter(k=>!prefix||k.startsWith(prefix)).map(key=>({key}))};},
    async getWithMetadata(key){
      return rows.has(key)
        ?{data:rows.get(key),etag:tags.get(key)||'"init"'}:null;
    },
    async setJSON(key,data,options={}){
      if(options.onlyIfNew&&rows.has(key))return {modified:false};
      if(options.onlyIfMatch&&
         (!rows.has(key)||(tags.get(key)||'"init"')!==options.onlyIfMatch))
        return {modified:false};
      const etag='"etag-'+(++seq)+'"';
      rows.set(key,data);tags.set(key,etag);
      return {modified:true,etag};
    }
  };
}
function accounts({name="Alex Example",address="4 Market Street, Bangor BT20 4AA",
  bookings=1}={}){
  const contact={name,email:EMAIL,address,enrolledAt:"2026-10-31T10:00:00Z",
    bookingIds:Array.from({length:bookings},(_,i)=>"NBG-B"+i)};
  const live={_id:UUID,status:"active",email:EMAIL,name:"Alex Example",
    address:{addressDescription:"4 Market St, Bangor BT20 4AA"}};
  const publicStore=store([[playerKey,{points:650}]]);
  const privateStore=store([[playerKey,contact]]);
  const linkStore=store();
  return {account:{id:UUID,email:EMAIL},liveCustomer:live,
    publicStore,privateStore,linkStore};
}

test("only recognised website achievements count; booking IDs and cookie totals do not",()=>{
  const all=Object.keys(merge.ACTIVITY_POINTS);
  assert.equal(merge.activityXP(all),460);
  assert.equal(merge.activityXP(all.concat(all)),460);
  assert.equal(merge.activityXP(["l:what-we-do","a:coverage"]),75);
  assert.equal(merge.activityXP(["b:fake-booking","999999 XP","a:coverage"]),25);
  assert.equal(merge.activityXP(Array(201).fill("l:what-we-do")),0);
});

test("device website XP is saved by Squeegee UUID and deduplicated across logins",async()=>{
  const db=store();
  const opts={store:db,customerId:UUID};
  const first=await merge.syncActivity({...opts,claimed:["l:what-we-do","a:coverage"]});
  assert.deepEqual({changed:first.changed,points:first.points},{changed:true,points:75});
  const repeat=await merge.syncActivity({...opts,claimed:["l:what-we-do","a:coverage"]});
  assert.equal(repeat.changed,false);
  assert.equal(repeat.points,75);
  const second=await merge.syncActivity({...opts,claimed:["l:the-process","b:unverified-booking"]});
  assert.equal(second.changed,true);
  assert.equal(second.points,125);
  assert.equal(await merge.readActivity(db,UUID),125);
  assert.ok(!JSON.stringify([...db.rows.values()]).includes(EMAIL));
  assert.ok(!JSON.stringify([...db.rows.values()]).includes("unverified-booking"));
  assert.equal(await merge.readActivity(db,OTHER),0);
});

test("website scores merge with historic cleans exactly once",()=>{
  const website=merge.combinedWebsiteXP({
    linkedPoints:650,linkedProgressXP:100,portalActivityXP:150,
  });
  assert.equal(website,700); // 550 booking + max(100 previous,150 new)
  assert.equal(6600+website,7300);
  assert.equal(merge.combinedWebsiteXP({portalActivityXP:150}),150);
  assert.equal(merge.combinedWebsiteXP({
    linkedPoints:650,linkedProgressXP:100,portalActivityXP:100
  }),650);
  assert.equal(merge.combinedWebsiteXP({
    linkedPoints:650,linkedProgressXP:100,portalActivityXP:0
  }),650);
});

test("email-code login links a previously booked site player only with full verified identity",async()=>{
  const deps=accounts();
  const result=await merge.linkVerifiedPortalAccount(deps);
  assert.deepEqual(result,{linked:true,unchanged:false});
  assert.equal(deps.linkStore.rows.get(playerKey).squeegeeId,UUID);
  assert.deepEqual(await merge.linkVerifiedPortalAccount(deps),
    {linked:true,unchanged:true});
  const serial=JSON.stringify(deps.linkStore.rows.get(playerKey));
  assert.ok(!serial.includes(EMAIL));
  assert.ok(!serial.includes("Market Street"));
  assert.ok(!serial.includes("Alex Example"));
});

test("wrong property, name, multiple bookings or conflicting UUID cannot claim booking XP",async()=>{
  const wrongAddress=accounts({address:"14 Market Street, Bangor BT20 4AA"});
  assert.equal((await merge.linkVerifiedPortalAccount(wrongAddress)).linked,false);
  const wrongName=accounts({name:"Different Resident"});
  assert.equal((await merge.linkVerifiedPortalAccount(wrongName)).linked,false);
  const sharedProperty=accounts({bookings:2});
  assert.equal((await merge.linkVerifiedPortalAccount(sharedProperty)).linked,false);
  const noBooking=accounts({bookings:0});
  assert.equal((await merge.linkVerifiedPortalAccount(noBooking)).linked,false);
  const changedLive=accounts();
  changedLive.liveCustomer._id=OTHER;
  assert.equal((await merge.linkVerifiedPortalAccount(changedLive)).linked,false);
  const inactive=accounts();
  inactive.liveCustomer.status="inactive";
  assert.equal((await merge.linkVerifiedPortalAccount(inactive)).linked,false);
  const collision=accounts();
  collision.linkStore.rows.set("player:"+"a".repeat(64),{
    squeegeeId:UUID,verified:true,
  });
  const conflict=await merge.linkVerifiedPortalAccount(collision);
  assert.equal(conflict.linked,false);
  assert.equal(conflict.reason,"multiple_site_profiles_for_customer");
  assert.equal(collision.linkStore.rows.has(playerKey),false);
});

test("public Preview 1 board merges private login activity and verified bookings",async()=>{
  const original=active.canonicalLegacyRef;
  const ref=history.ENTRIES[0][0];
  active.canonicalLegacyRef=(id)=>id===UUID?ref:original(id);
  try {
    const activity=store([[merge.activityKey(UUID),{
      claimed:["l:what-we-do","l:the-process","a:coverage"],
    }]]);
    const empty={links:store(),public:store(),private:store(),activity};
    const none=await board.getStaticPreviewBoard(empty,NOW);
    const baseline=history.ENTRIES[0][2];
    assert.equal(none.entries.find(x=>x.customerRef===ref).points,baseline+125);
    const data=accounts();
    data.privateStore.rows.get(playerKey).progressXP=100;
    const input={links:data.linkStore,public:data.publicStore,
      private:data.privateStore,activity};
    await merge.linkVerifiedPortalAccount(data);
    const combined=await board.getStaticPreviewBoard(input,NOW,true);
    assert.equal(combined.entries.find(x=>x.customerRef===ref).points,
      baseline+675); // 650 - 100 website activity + max(100,125)
    const repeat=await board.getStaticPreviewBoard(input,NOW,true);
    assert.equal(repeat.entries.find(x=>x.customerRef===ref).points,
      baseline+675);
    assert.equal(combined.totalPlayers,941);
    assert.ok(!JSON.stringify(combined).includes(UUID));
  } finally {
    active.canonicalLegacyRef=original;
  }
});
