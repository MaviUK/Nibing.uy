"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const annual=require("../netlify/functions/lib/squeegeeYearlyPreviewBoard");
const names=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const active=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const history=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");

const NOW=Date.parse("2026-11-01T17:00:00Z");
const IDS=[
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const aliases=IDS.map(active.canonicalLegacyRef);
const eligible=new Set(aliases.slice(0,2));
const playerA="player:"+"a".repeat(64);
const playerB="player:"+"b".repeat(64);
const iso=history.AS_OF;
const CLEAN=(date,points)=>({date,points,event:"paid_completed_clean"});
const sample={
  version:1,asOf:iso,
  accounts:[
    {id:IDS[0],ref:"CUS101",email:"sarah@example.co.uk",firstName:"Sarah",town:"Bangor",
     events:[CLEAN("2024-06-01",20),CLEAN("2025-01-15",22),CLEAN("2025-05-01",24),
       CLEAN("2026-10-20",26),{date:"2026-10-27",event:"recorded_skip",points:0}]},
    {id:IDS[1],ref:"CUS102",email:"john@example.co.uk",firstName:"John",town:"Comber",
     events:[CLEAN("2025-02-03",30),CLEAN("2026-08-04",34)]},
    {id:IDS[2],ref:"CUS103",email:"",firstName:"Nora",town:"Holywood",
     events:[CLEAN("2024-02-01",200)]}
  ]
};
function fakeStore(rows=[]){
  const map=new Map(rows);
  return {
    rows:map,
    async get(key){return map.get(key)||null;},
    async list({prefix}){return {blobs:[...map.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}
  };
}
function fixtures({colliding=false}={}){
  const websiteA={
    claimed:["l:what-we-do","l:the-process"],firstRecordedAt:"2026-11-01T12:00:00Z",
    events:[
      {key:"l:what-we-do@2026-11",earnedAt:"2026-11-01T12:01:00Z"},
      {key:"a:customer-portal@2026-11-01",earnedAt:"2026-11-01T12:02:00Z"}
    ]
  };
  const websiteB={
    claimed:["a:coverage"],firstRecordedAt:"2026-11-01T15:00:00Z",
    events:[{key:"a:contact@2026-11-01",earnedAt:"2026-11-01T12:03:00Z"}]
  };
  return {
    activity:fakeStore([
      ["customer:"+IDS[0],websiteA],["customer:"+IDS[1],websiteB],
      ["customer:"+IDS[2],{events:[{key:"a:contact@2026-11-01",earnedAt:"2026-11-01T12:04:00Z"}]}],
    ]),
    links:fakeStore([
      [playerA,{squeegeeId:IDS[0],verified:true}],
      ...(colliding?[[playerB,{squeegeeId:IDS[0],verified:true}]]:[])
    ]),
    public:fakeStore([[playerA,{points:260}],[playerB,{points:300}]]),
    private:fakeStore([[playerA,{
      progressXP:50,bookingAwards:[
        {id:"NBG-BOOK-2025",points:60,at:"2025-12-10T12:00:00Z"},
        {id:"NBG-BOOK-2026",points:150,at:"2026-10-30T12:00:00Z"}
      ]
    }],[playerB,{progressXP:0,bookingAwards:[{id:"NBG-B",points:300,at:"2026-11-01T11:00:00Z"}]}]])
  };
}
const permissions={
  version:1,sourceAsOf:history.AS_OF,records:aliases.map((alias,i)=>({
    alias,town:sample.accounts[i].town,firstName:sample.accounts[i].firstName,
    consent:"pending",withdrawnAt:null,
  }))
};

test("valid annual choices are 2024, 2025 and 2026; year 2027 is not selectable early",()=>{
  assert.deepEqual(annual.availableYears(NOW),[2024,2025,2026]);
  for(const year of [2024,2025,2026])assert.equal(annual.validYear(year,NOW),true);
  for(const year of ["2024",2023,2027,0,NaN])
    assert.equal(annual.validYear(year,NOW),false);
});

test("Squeegee yearly cleaning XP use ACTUAL service dates, not cumulative streak totals",()=>{
  const alice=sample.accounts[0].events;
  assert.equal(annual.annualCleaningXP(alice,2024,iso),20);
  assert.equal(annual.annualCleaningXP(alice,2025,iso),46);
  assert.equal(annual.annualCleaningXP(alice,2026,iso),26);
  assert.equal(annual.annualCleaningXP(alice,2027,iso),0);
  assert.equal(annual.annualCleaningXP([CLEAN("2026-11-01",900)],2026,iso),0,
    "the October backup cannot assert a future cleaning event");
});

test("dated website activity and confirmed bookings count in their own calendar years",async()=>{
  const stores=fixtures();
  const scores=await annual.datedWebsiteXP(stores,eligible,NOW);
  assert.equal(scores.get(aliases[0]).get(2025),60);
  assert.equal(scores.get(aliases[0]).get(2026),225,
    "50 level + 25 portal + 150 confirmed booking");
  assert.equal(scores.get(aliases[1]).get(2026),25);
  assert.equal(scores.has(aliases[2]),false,"account without email is excluded");
  assert.equal(scores.get(aliases[0]).get(2024)||0,0);
});

test("annual board gives correct ranking per year; Overall is not fabricated from the same total",async()=>{
  const stores=fixtures();
  const expected={
    2024:[{ref:aliases[0],points:20}],
    2025:[{ref:aliases[0],points:106},{ref:aliases[1],points:30}],
    2026:[{ref:aliases[0],points:251},{ref:aliases[1],points:59}]
  };
  for(const year of [2024,2025,2026]){
    const board=await annual.getAnnualPreviewBoard(stores,sample,eligible,year,NOW);
    assert.equal(board.status,"squeegee_active_only");
    assert.equal(board.sourceAsOf,history.AS_OF);
    assert.equal(board.year,year);
    assert.equal(board.totalPlayers,expected[year].length);
    assert.deepEqual(board.entries.map(row=>({
      ref:row.customerRef,points:row.points
    })),expected[year]);
  }
});

test("another verified website player linked to one Squeegee UUID suppresses ambiguous booking XP",async()=>{
  const yearly=await annual.datedWebsiteXP(fixtures({colliding:true}),eligible,NOW);
  assert.equal(yearly.get(aliases[0]).get(2026),75,
    "unambiguous account activity remains, but conflicting booking points are held");
  assert.equal(yearly.get(aliases[0]).get(2025)||0,0);
});

test("undated historical website XP stays Overall, not automatically added to 2026",async()=>{
  const stores=fixtures();
  stores.activity.rows.set("customer:"+IDS[1],{
    claimed:["l:what-we-do","a:coverage","a:bin-checker"],
    firstRecordedAt:"2026-11-01T16:00:00Z",
  });
  const b=await annual.getAnnualPreviewBoard(stores,sample,eligible,2026,NOW);
  assert.equal(b.entries.find(row=>row.customerRef===aliases[1]).points,34,
    "legacy claims do not inherit the import date as their earning date");
});

test("yearly public board uses identical opaque refs and withdrawal rules as Overall",async()=>{
  const full=await annual.getAnnualPreviewBoard(fixtures(),sample,eligible,2026,NOW);
  const key=crypto.randomBytes(32);
  const publicBoard=names.previewFirstNameScoreboard(
    sample,full,eligible,permissions,key);
  assert.ok(publicBoard);
  assert.equal(publicBoard.status,"preview_public_first_names");
  assert.deepEqual(publicBoard.entries.map(r=>r.displayName),["Sarah","John"]);
  assert.deepEqual(publicBoard.entries.map(r=>r.points),[251,59]);
  assert.ok(publicBoard.entries.every(r=>/^NBG-[A-F0-9]{10}$/.test(r.customerRef)));
  const earlier=await annual.getAnnualPreviewBoard(fixtures(),sample,eligible,2025,NOW);
  const previousNames=names.previewFirstNameScoreboard(sample,earlier,eligible,permissions,key);
  assert.equal(previousNames.entries[0].customerRef,publicBoard.entries[0].customerRef,
    "the opaque public player reference is stable between years");
  const withdrawn={...permissions,records:permissions.records.map((r,i)=>
    i===0?{...r,consent:"withdrawn",withdrawnAt:"2026-11-01T13:00:00Z"}:r)};
  const filtered=names.previewFirstNameScoreboard(sample,full,eligible,withdrawn,key);
  assert.equal(filtered.totalPlayers,1);
  assert.equal(filtered.entries[0].displayName,"John");
  const raw=JSON.stringify(publicBoard);
  for(const item of [...IDS,...aliases,"CUS101","CUS102",
      "sarah@example.co.uk","john@example.co.uk","NBG-BOOK-2026"]){
    assert.ok(!raw.includes(item),"private value should not leak: "+item);
  }
});

test("API accepts annual filters on Preview 77 only and rejects unsupported or malformed years",async()=>{
  const original=Module._load;
  const oldNow=Date.now;
  Date.now=()=>NOW;
  const store={get:async()=>null,list:async()=>({blobs:[]})};
  Module._load=function(id,parent,isMain){
    if(id==="@netlify/blobs")return {getStore:()=>store};
    return original.call(this,id,parent,isMain);
  };
  try{
    const modulePath=require.resolve("../netlify/functions/arcadeLeaderboard");
    delete require.cache[modulePath];
    const {handler}=require(modulePath);
    const event=year=>({httpMethod:"GET",
      headers:{host:"deploy-preview-77--nibinguy.netlify.app"},
      queryStringParameters:year===null?{}:{year}});
    for(const value of ["2023","2027","2026abc","1e9","__proto__",""]){
      const result=await handler(event(value));
      assert.equal(result.statusCode,400,value);
    }
    for(const value of ["2024","2025","2026"]){
      const result=await handler(event(value));
      assert.equal(result.statusCode,200);
      const data=JSON.parse(result.body);
      assert.equal(data.period,value);
      assert.deepEqual(data.availableYears,[2024,2025,2026]);
      assert.equal(data.status,"eligibility_pending");
      assert.deepEqual(data.entries,[]);
    }
    const overall=JSON.parse((await handler(event(null))).body);
    assert.equal(overall.period,"overall");
    assert.deepEqual(overall.availableYears,[2024,2025,2026]);
    const source=fs.readFileSync(path.join(__dirname,
      "../netlify/functions/arcadeLeaderboard.js"),"utf8");
    assert.match(source,/if\(isExactN64PreviewRequest\(event\)\)/);
    assert.match(source,/yearlyPreview\.getAnnualPreviewBoard\(/);
    assert.match(source,/nameConsents\.previewFirstNameScoreboard\(/);
    assert.ok(source.indexOf('const activeBoard=await getActiveHistoricalBoard(stores);')>
      source.indexOf('yearlyPreview.getAnnualPreviewBoard('),
      "production fallback stays outside the private preview branch");
  }finally{
    Module._load=original;
    Date.now=oldNow;
    delete require.cache[require.resolve("../netlify/functions/arcadeLeaderboard")];
  }
});

test("mobile year selector has Overall, years, selection state and resets row pagination",()=>{
  const ui=fs.readFileSync(path.join(__dirname,"../src/components/ArcadeLeaderboard.jsx"),"utf8");
  const css=fs.readFileSync(path.join(__dirname,"../src/n64-finale.css"),"utf8");
  assert.match(ui,/useState\("overall"\)/);
  assert.match(ui,/aria-label="Choose leaderboard year"/);
  assert.match(ui,/\["overall",\.\.\.availableYears\]/);
  assert.match(ui,/aria-pressed=\{selectedYear===String\(period\)\}/);
  assert.match(ui,/setPublicShownCount\(20\)/);
  assert.match(ui,/setSelectedYear\(period\)/);
  assert.match(ui,/ENDPOINT\+"\?year="\+encodeURIComponent\(selectedYear\)/);
  assert.match(ui,/data\.period!==selectedYear/);
  assert.match(ui,/selectedYear==="overall"\?"Global Leaderboard":selectedYear\+" Leaderboard"/);
  assert.match(ui,/Older undated website XP stays in Overall/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/\.n64-leaderboard-years \.n64-year-selected/);
});
