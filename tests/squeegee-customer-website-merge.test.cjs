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


test("UK calendar monthly levels reset in a new month and require earlier levels",async()=>{
  const db=store(),id=UUID;
  const oct=Date.parse("2026-10-31T17:00:00Z");
  const nov=Date.parse("2026-11-01T11:00:00Z");
  const event=(id,month,at)=>({key:"l:"+id+"@"+month,at:new Date(at).toISOString()});
  const oldFirst=event("what-we-do","2026-10",oct);
  const oldSecond=event("the-process","2026-10",oct+1000);
  const first=await merge.syncActivity({store:db,customerId:id,events:[oldFirst,oldSecond],now:oct+1000});
  assert.deepEqual({changed:first.changed,points:first.points},{changed:true,points:100});
  const repeat=await merge.syncActivity({store:db,customerId:id,events:[oldSecond],now:oct+2000});
  assert.deepEqual({changed:repeat.changed,points:repeat.points},{changed:false,points:100});
  const skipped=await merge.syncActivity({store:db,customerId:id,
    events:[event("the-process","2026-11",nov)],now:nov});
  assert.deepEqual({changed:skipped.changed,points:skipped.points},{changed:false,points:100});
  const next=await merge.syncActivity({store:db,customerId:id,
    events:[event("what-we-do","2026-11",nov),event("the-process","2026-11",nov+1000)],now:nov+1000});
  assert.deepEqual({changed:next.changed,points:next.points},{changed:true,points:200});
  const balance=merge.activityBalance(db.rows.get(merge.activityKey(id)));
  assert.equal(balance.legacyXP,0);
  assert.equal(balance.periodicXP,200);
  assert.equal(merge.activityHistory(db.rows.get(merge.activityKey(id))).length,4);
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


test("previously earned level and bin-day XP show the saved account date, not an invented earning date",()=>{
  const stored={version:1,claimed:["l:what-we-do","a:bin-checker"],
    updatedAt:"2026-10-30T12:45:00.000Z",events:[]};
  const items=merge.activityHistory(stored,Date.parse("2026-11-01T15:00:00Z"));
  assert.equal(items.length,2);
  assert.equal(items.reduce((sum,e)=>sum+e.points,0),85);
  for(const entry of items){
    assert.equal(entry.date,"2026-10-30");
    assert.equal(entry.dateKind,"recorded");
    assert.equal(entry.earnedAt,null);
    assert.equal(entry.recordedAt,"2026-10-30T12:45:00.000Z");
    assert.match(entry.note,/Exact earning date not saved/);
  }
});

test("initial import records a date, and later activities never overwrite the older recorded-on date",async()=>{
  const initial=Date.parse("2026-11-01T15:00:00Z");
  const next=Date.parse("2026-11-02T12:00:00Z");
  const db=store();
  await merge.syncActivity({
    store:db,customerId:UUID,claimed:["l:the-process"],now:initial
  });
  let saved=db.rows.get(merge.activityKey(UUID));
  assert.equal(saved.firstRecordedAt,new Date(initial).toISOString());
  await merge.syncActivity({
    store:db,customerId:UUID,now:next,
    events:[{key:"a:contact@2026-11-02",at:new Date(next).toISOString()}]
  });
  saved=db.rows.get(merge.activityKey(UUID));
  assert.equal(saved.firstRecordedAt,new Date(initial).toISOString());
  const history=merge.activityHistory(saved,next+1000);
  const legacy=history.find(e=>e.category==="website_level");
  const fresh=history.find(e=>e.label==="Opened Contact Us");
  assert.equal(legacy.dateKind,"recorded");
  assert.equal(legacy.date,"2026-11-01");
  assert.equal(fresh.date,"2026-11-02");
  assert.equal(fresh.earnedAt,new Date(next).toISOString());
  assert.equal(legacy.points+fresh.points,75);
});

test("existing legacy records inherit the older saved timestamp, never reset to today's date",async()=>{
  const past="2026-10-22T10:22:00.000Z",now=Date.parse("2026-11-01T12:00:00Z");
  const db=store([[merge.activityKey(UUID),{
    claimed:["a:coverage"],updatedAt:past,version:1
  }]]);
  const result=await merge.syncActivity({
    store:db,customerId:UUID,now,
    events:[{key:"a:contact@2026-11-01",at:new Date(now).toISOString()}]
  });
  assert.equal(result.points,50);
  assert.equal(db.rows.get(merge.activityKey(UUID)).firstRecordedAt,past);
  const rows=merge.activityHistory(db.rows.get(merge.activityKey(UUID)),now);
  assert.equal(rows.find(e=>e.label==="Checked service area").date,"2026-10-22");
  assert.equal(rows.find(e=>e.label==="Opened Contact Us").date,"2026-11-01");
});

test("earlier linked bookings use an account record date, but verified booking awards keep the actual date",()=>{
  assert.equal(merge.recordedAtFrom({
    lastUpdatedAt:"2026-10-29T13:00:00.000Z",
    enrolledAt:"2026-08-01T12:00:00.000Z"
  },Date.parse("2026-11-01T15:00:00Z")),"2026-10-29T13:00:00.000Z");
  const fs=require("node:fs"),path=require("node:path");
  const root=path.resolve(__dirname,"..");
  const api=fs.readFileSync(path.join(root,"netlify/functions/customerHQ.mjs"),"utf8");
  const ui=fs.readFileSync(path.join(root,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(api,/const recordedAt=merge\.recordedAtFrom\(linked\)/);
  assert.match(api,/label:"Earlier confirmed website bookings"/);
  assert.match(api,/dateKind:"earned"/);
  assert.match(api,/dateKind:"recorded"/);
  assert.match(ui,/entry\.dateKind==="recorded"\?"Recorded on "/);
  assert.match(ui,/entry\.source==="website"\?"Earned on "/);
});


test("server does not award skipped levels or reorder an out-of-order submitted batch",async()=>{
  const db=store();
  const now=Date.parse("2026-11-01T15:00:00Z");
  const ids=["what-we-do","the-process","bins-we-clean","why-clean-your-bin",
    "why-ni-bin-guy","areas-we-cover","customer-portal","level-08-final"];
  const make=(id,n)=>({
    key:"l:"+id+"@2026-11",at:new Date(now+n*1000).toISOString(),
  });
  const result=await merge.syncActivity({store:db,customerId:UUID,now:now+15000,
    events:[make(ids[6],6),make(ids[2],2),make(ids[0],0),make(ids[1],1)]
  });
  assert.equal(result.points,100);
  assert.deepEqual(db.rows.get(merge.activityKey(UUID)).events
    .filter(e=>e.category==="website_level").map(e=>e.rule),
    ["l:what-we-do","l:the-process"]);
  const later=await merge.syncActivity({store:db,customerId:UUID,
    events:ids.slice(2).map((id,i)=>make(id,i+2)),now:now+15000});
  assert.equal(later.points,400);
  const repeat=await merge.syncActivity({store:db,customerId:UUID,
    events:ids.map((id,i)=>make(id,i)),now:now+20000});
  assert.equal(repeat.changed,false);
  assert.equal(repeat.points,400);
});

test("same-day level rows appear in ascending level number, with older days first",()=>{
  const rows=[
    {date:"2026-11-01",category:"website_level",label:"Website level 07 completed",points:50,earnedAt:"2026-11-01T12:00:00Z"},
    {date:"2026-11-01",category:"website_level",label:"Website level 03 completed",points:50,earnedAt:"2026-11-01T15:00:00Z"},
    {date:"2026-11-01",category:"website_level",label:"Website level 01 completed",points:50,earnedAt:"2026-11-01T10:00:00Z"},
    {date:"2026-11-01",category:"website_action",label:"Visited customer portal",points:25,earnedAt:"2026-11-01T16:00:00Z"},
    {date:"2026-10-31",category:"website_level",label:"Website level 02 completed",points:50,earnedAt:"2026-10-31T13:00:00Z"},
  ];
  const result=merge.sortedRewardsHistory([{date:"2026-11-01",points:22,event:"paid_completed_clean"}],rows);
  assert.deepEqual(result.slice(0,3).map(e=>e.label),[
    "Website level 01 completed","Website level 03 completed","Website level 07 completed"
  ]);
  assert.equal(result.at(-1).date,"2026-10-31");
  assert.equal(result.reduce((sum,e)=>sum+e.points,0),247);
  assert.equal(merge.levelOrdinal("Website level 01 completed"),1);
  assert.equal(merge.levelOrdinal("Website level 08 completed"),8);
  assert.equal(merge.levelOrdinal("Contact Us"),null);
});

test("already recorded legacy out-of-order rewards retain their awarded XP",async()=>{
  const previous=[
    {key:"l:customer-portal@2026-11",rule:"l:customer-portal",period:"2026-11",
      points:50,category:"website_level",label:"Website level 07 completed",
      earnedAt:"2026-11-01T08:00:00.000Z"},
  ];
  const db=store([[merge.activityKey(UUID),{
    version:2,claimed:[],events:previous,updatedAt:"2026-11-01T09:00:00Z",
  }]]);
  const now=Date.parse("2026-11-01T15:00:00Z");
  const response=await merge.syncActivity({store:db,customerId:UUID,now,
    events:[{key:"l:level-08-final@2026-11",at:new Date(now).toISOString()}]});
  assert.equal(response.points,50);
  assert.equal(response.changed,false);
  assert.equal(merge.activityBalance(db.rows.get(merge.activityKey(UUID))).total,50);
});
