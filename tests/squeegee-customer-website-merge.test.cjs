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


test("UK calendar monthly levels reset in a new month, never multiple times in one month",async()=>{
  const db=store(),id=UUID;
  const oct=Date.parse("2026-10-31T17:00:00Z");
  const nov=Date.parse("2026-11-01T11:00:00Z");
  const oldEvent={key:"l:the-process@2026-10",at:new Date(oct).toISOString()};
  const newEvent={key:"l:the-process@2026-11",at:new Date(nov).toISOString()};
  const first=await merge.syncActivity({store:db,customerId:id,events:[oldEvent],now:oct});
  assert.deepEqual({changed:first.changed,points:first.points},{changed:true,points:50});
  const repeat=await merge.syncActivity({store:db,customerId:id,events:[oldEvent],now:oct+1000});
  assert.deepEqual({changed:repeat.changed,points:repeat.points},{changed:false,points:50});
  const next=await merge.syncActivity({store:db,customerId:id,events:[newEvent],now:nov});
  assert.deepEqual({changed:next.changed,points:next.points},{changed:true,points:100});
  const balance=merge.activityBalance(db.rows.get(merge.activityKey(id)));
  assert.equal(balance.legacyXP,0);
  assert.equal(balance.periodicXP,100);
  assert.equal(merge.activityHistory(db.rows.get(merge.activityKey(id))).length,2);
});
test("daily actions reset at UK midnight, not at UTC midnight",async()=>{
  const db=store();
  const a=Date.parse("2026-07-01T22:40:00Z"); // 23:40 UK
  const b=Date.parse("2026-07-01T23:20:00Z"); // 00:20 next UK day
  assert.equal(merge.ukDay(a),"2026-07-01");
  assert.equal(merge.ukDay(b),"2026-07-02");
  const first=await merge.syncActivity({
    store:db,customerId:UUID,now:a,
    events:[{key:"a:free-clean@2026-07-01",at:new Date(a).toISOString()}],
  });
  assert.equal(first.points,25);
  assert.equal((await merge.syncActivity({
    store:db,customerId:UUID,now:a+2000,
    events:[{key:"a:free-clean@2026-07-01",at:new Date(a).toISOString()}]
  })).points,25);
  const next=await merge.syncActivity({
    store:db,customerId:UUID,now:b,
    events:[{key:"a:free-clean@2026-07-02",at:new Date(b).toISOString()}],
  });
  assert.equal(next.points,50);
});
test("daily portal/contact award separately; bin lookup stays once for life",async()=>{
  const db=store(),now=Date.parse("2026-11-01T13:00:00Z");
  const rows=["a:contact","a:customer-portal"].map(rule=>({
    key:rule+"@2026-11-01",at:new Date(now).toISOString(),
    points:9999999 // ignored: server computes fixed values
  }));
  let r=await merge.syncActivity({store:db,customerId:UUID,
    claimed:["a:bin-checker"],events:rows,now});
  assert.equal(r.points,85);
  r=await merge.syncActivity({store:db,customerId:UUID,
    claimed:["a:bin-checker"],events:rows,now});
  assert.equal(r.changed,false);
  assert.equal(r.points,85);
  const next=Date.parse("2026-11-02T13:00:00Z");
  r=await merge.syncActivity({store:db,customerId:UUID,now:next,
    events:rows.map(e=>({key:e.key.replace("11-01","11-02"),at:new Date(next).toISOString()}))});
  assert.equal(r.points,135);
  assert.equal(merge.activityHistory(db.rows.get(merge.activityKey(UUID))).length,5);
});
test("unknown action, fake booking, forged future keys and malformed calendar dates earn nothing",async()=>{
  const now=Date.parse("2026-11-01T13:00:00Z"),at=new Date(now).toISOString();
  for(const key of ["a:free-clean@2026-11-02","a:free-clean@2026-02-30",
    "l:what-we-do@2026-12","b:fake-booking@2026-11-01",
    "a:contact@2026-13-01"]){
    assert.equal(merge.normalisePeriodEvent({key,at},now),null,key);
  }
  const db=store();
  const result=await merge.syncActivity({store:db,customerId:UUID,
    events:[{key:"b:fake-booking@2026-11-01",at}],now});
  assert.equal(result.points,0);
  assert.equal(db.rows.size,0);
});
test("old website activity and new dated rewards do not duplicate when linked",async()=>{
  const db=store(),now=Date.parse("2026-11-01T12:00:00Z");
  await merge.syncActivity({store:db,customerId:UUID,
    claimed:["l:what-we-do"],now});
  await merge.syncActivity({store:db,customerId:UUID,now,
    events:[{key:"l:what-we-do@2026-11",at:new Date(now).toISOString()}]});
  const parts=merge.activityBalance(db.rows.get(merge.activityKey(UUID)));
  assert.equal(parts.legacyXP,50);
  assert.equal(parts.periodicXP,50);
  assert.equal(merge.combinedWebsiteXP({
    linkedPoints:550,linkedProgressXP:50,portalActivityXP:parts.legacyXP,
    portalPeriodicXP:parts.periodicXP,
  }),600);
});
test("website history and the badge use private verified account data only",()=>{
  const fs=require("node:fs"),path=require("node:path");
  const root=path.resolve(__dirname,"..");
  const read=f=>fs.readFileSync(path.join(root,f),"utf8");
  const hud=read("public/n64-scoreboard.js");
  const portal=read("src/pages/CustomerHQ.jsx");
  const api=read("netlify/functions/customerHQ.mjs");
  const scores=read("netlify/functions/arcadeLeaderboard.js");
  const hqPortal=read("src/components/CustomerPortalLoader.jsx");
  const challenge=read("src/TenSecondChallenge.jsx");
  const landing=read("src/LandingPage.jsx");
  assert.match(hud,/accountTotal === null \? xp : accountTotal/);
  assert.match(hud,/\/api\/customer-hq/);
  assert.match(hud,/activityEvents:/);
  assert.match(portal,/n64:account-score/);
  assert.match(portal,/account\.rewardsHistory/);
  assert.match(portal,/MY TOTAL REWARDS/);
  assert.match(api,/rewardsHistory:allRewardsHistory/);
  assert.match(api,/events:Array\.isArray\(body\.events\)/);
  assert.match(scores,/bookingAwards,/);
  assert.match(hqPortal,/awardAction\("customer-portal"\)/);
  assert.match(challenge,/awardAction\("free-clean"\)/);
  assert.match(landing,/awardAction\("contact"\)/);
});
