"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const award=require("../netlify/functions/lib/squeegeePreviewOwnerAchievements");
const pub=require("../netlify/functions/lib/squeegeePublicAchievementHighlights");
const history=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const crypto=require("node:crypto");
const previewKey=Buffer.alloc(32,23);
function publishedBoard(accounts,pointsFor=(row,i)=>100+i){
 return {status:"preview_public_first_names",sourceAsOf:asOf,
  entries:accounts.map((row,i)=>({
    customerRef:"NBG-"+crypto.createHmac("sha256",previewKey)
      .update("n64-preview-public-first-name-v1:"+
        history.canonicalLegacyRef(row.id))
      .digest("hex").slice(0,10).toUpperCase(),
    displayName:row.firstName,town:row.town,points:pointsFor(row,i)
  }))};
}
const asOf="2026-11-06";
const id1="11111111-1111-4111-8111-111111111111";
const id2="22222222-2222-4222-8222-222222222222";
const paid=(date,j,streak,quantity=1)=>({
 date,j,event:"paid_completed_clean",streak,quantity,points:20
});
const skip=(date,j)=>({date,j,event:"recorded_skip",streak:0,points:0,quantity:0});
const primary={
 id:id1,ref:"101",firstName:"Alex",town:"Bangor",paidCleans:99,
 jobs:[
  {id:"j-blue",label:"Blue",currentStreak:3,lastCompletedOn:asOf,paidCleans:99},
  {id:"j-black",label:"Black",currentStreak:0,lastCompletedOn:"2025-07-01",paidCleans:99}
 ],
 events:[
  paid("2024-10-01",1,1),
  paid("2024-11-12",0,3,2),
  paid("2024-12-10",0,4),
  paid("2025-01-07",0,5),
  skip("2025-02-04",0),
  paid("2025-05-02",0,1,2),
  paid("2025-07-01",1,2),
  paid("2026-10-09",0,2,2),
  paid(asOf,0,3)
 ]
};
const second={
 id:id2,ref:"202",firstName:"Private",town:"Comber",paidCleans:1000,
 jobs:[{id:"j-private",label:"Blue",currentStreak:21,lastCompletedOn:asOf,paidCleans:1000}],
 events:[paid(asOf,0,21)]
};
test("year-specific streaks use that year's actual recorded events, not today's job state",()=>{
 const y24=award.awards([primary],{asOf,year:2024});
 const y25=award.awards([primary],{asOf,year:2025});
 const y26=award.awards([primary],{asOf,year:2026});
 const all=award.awards([primary],{asOf});
 assert.equal(y24.byColour.Blue[0].best,2); // Two distinct 2024 visits, NOT lifetime streak 4
 assert.equal(y24.byColourCurrent.Blue[0].active,2);
 assert.equal(y24.periodEnd,"2024-12-31");
 assert.equal(y25.byColour.Blue[0].best,1); // January lifetime streak 5 counts as one 2025 clean
 assert.equal(y25.byColourCurrent.Blue.length,0);
 assert.equal(y25.periodEnd,"2025-12-31");
 assert.equal(y26.byColour.Blue[0].best,2);
 assert.equal(y26.byColourCurrent.Blue[0].active,2);
 assert.equal(y26.periodEnd,asOf);
 assert.equal(all.byColour.Blue[0].best,5);
 assert.equal(all.byColourCurrent.Blue[0].active,3);
 assert.equal(award.awards([primary],{asOf,year:2027}),null);
});
test("a year counts paid physical quantities and only jobs cleaned that year",()=>{
 const r=award.awards([primary],{asOf,year:2025});
 assert.equal(r.paidBins[0].paidBins,4);
 assert.equal(r.mostJobs[0].jobs,2);
 assert.equal(r.combined[0].combined,2); // 2024 dates and pre-skip cleans excluded
 assert.equal(r.combinedCurrent.length,0);
 const y26=award.awards([primary],{asOf,year:2026});
 assert.equal(y26.paidBins[0].paidBins,3);
 assert.equal(y26.mostJobs[0].jobs,1);
});
test("town record results follow year selection and leave original import unchanged",()=>{
 const original=JSON.stringify([primary,second]);
 const towns=award.townRecords([primary,second],{asOf,year:2024});
 assert.equal(towns.find(t=>t.town==="Bangor").highest.best,2);
 assert.equal(towns.find(t=>t.town==="Comber").highest,null);
 assert.equal(JSON.stringify([primary,second]),original);
});
test("published record holders show first name, town and period XP while withdrawals stay private",()=>{
 const snapshot={version:1,asOf,accounts:[primary,second]};
 const a1=history.canonicalLegacyRef(id1),a2=history.canonicalLegacyRef(id2);
 const aliases=new Set([a1,a2]);
 const permissions={version:1,sourceAsOf:asOf,records:[
  {alias:a1,consent:"pending"},{alias:a2,consent:"withdrawn",withdrawnAt:asOf}
 ]};
 const board=publishedBoard([primary,second],(row,i)=>i?500:125);
 const year=pub.highlights(snapshot,aliases,permissions,"2025",board,previewKey);
 assert.equal(year.period,"2025");
 assert.equal(year.status,"preview_public_named_records");
 assert.equal(year.colours.find(row=>row.colour==="Blue").highest,1);
 assert.equal(year.colours.find(row=>row.colour==="Blue").current,0);
 assert.deepEqual(Object.keys(year.colours[0]).sort(),
   ["colour","current","currentTop","highest","highestTop"]);
 const blue=year.colours.find(row=>row.colour==="Blue");
 assert.deepEqual(blue.highestTop,[{displayName:"Alex",town:"Bangor",points:125,cleans:1}]);
 assert.deepEqual(blue.currentTop,[]);
 assert.ok(Array.isArray(year.longestJobCurrentTop));
 assert.ok(Array.isArray(year.longestJobHighestTop));
 assert.ok(Array.isArray(year.longestAllJobsCurrentTop));
 assert.ok(Array.isArray(year.longestAllJobsHighestTop));
 const json=JSON.stringify(pub.highlights(snapshot,aliases,permissions,"overall",board,previewKey));
 assert.ok(json.includes('"displayName":"Alex"'));
 assert.ok(json.includes('"town":"Bangor"'));
 assert.ok(json.includes('"points":125'));
 for(const secret of ["Private","Comber",id1,id2,a1,a2,"j-blue"])
   assert.ok(!json.includes(secret),secret);
 const wrong={...permissions,sourceAsOf:"2025-01-01"};
 assert.equal(pub.highlights(snapshot,aliases,wrong,"overall",board,previewKey),null);
 assert.equal(pub.highlights(snapshot,aliases,permissions,"2027",board,previewKey),null);
 assert.equal(pub.highlights(snapshot,new Set([a2]),permissions,"overall",board,previewKey),null);
 assert.equal(pub.highlights(snapshot,aliases,permissions,"overall",null,previewKey),null);
 assert.equal(pub.highlights(snapshot,aliases,permissions,"overall",board,null),null);
 assert.equal(pub.highlights(snapshot,aliases,permissions,"overall",
   {...board,sourceAsOf:"2025-01-01"},previewKey),null);
});

test("public achievements run only inside Preview 77 and cannot publish private winners",()=>{
 const api=fs.readFileSync(path.join(__dirname,"../netlify/functions/arcadeLeaderboard.js"),"utf8");
 assert.match(api,/if\(isExactN64PreviewRequest\(event\)\)/);
 assert.match(api,/publicRecords\.highlights\(\s*privateCustomers,eligible\.aliases,privateNames,period,\s*publicScores,privateKey\s*\)/);
 assert.match(api,/publicScores\?\.status==="preview_public_first_names"/);
 assert.ok(api.indexOf("const publicAchievements=")>api.indexOf("if(isExactN64PreviewRequest(event))"));
});

test("public top five ranks only already-public names with town and XP, excluding withdrawals",()=>{
 const firstNames=["Anna","Bella","Cara","David","Ellen","Frank","Gina","Helen"];
 const accounts=Array.from({length:8},(_,i)=>{
  const n=i+1;
  const id=String(n).padStart(8,"0")+"-1111-4111-8111-"+String(n).padStart(12,"0");
  return {id,ref:String(n),firstName:firstNames[i],town:"Bangor",paidCleans:n,
    jobs:[{id:"private-job-"+n,label:"Black",currentStreak:n,lastCompletedOn:asOf,
      paidCleans:n}],events:[paid(asOf,0,n)]};
 });
 const aliases=accounts.map(row=>history.canonicalLegacyRef(row.id));
 const snapshot={version:1,asOf,accounts};
 const permissions={version:1,sourceAsOf:asOf,records:aliases.map((alias,i)=>
  ({alias,consent:i===7?"withdrawn":"pending",withdrawnAt:i===7?asOf:null}))};
 const board=publishedBoard(accounts,(_,i)=>(i+1)*100);
 const publicView=pub.highlights(snapshot,new Set(aliases),permissions,
  "overall",board,previewKey);
 assert.ok(publicView);
 const black=publicView.colours.find(row=>row.colour==="Black");
 assert.deepEqual(black.currentTop.map(row=>row.cleans),[7,6,5,4,3]);
 assert.deepEqual(black.highestTop.map(row=>row.cleans),[7,6,5,4,3]);
 assert.deepEqual(black.currentTop.map(row=>row.points),[700,600,500,400,300]);
 assert.deepEqual(black.currentTop.map(row=>row.displayName),
  ["Gina","Frank","Ellen","David","Cara"]);
 assert.deepEqual(black.currentTop.map(row=>row.town),["Bangor","Bangor","Bangor","Bangor","Bangor"]);
 assert.equal(black.current,7);
 assert.equal(black.highest,7);
 assert.deepEqual(publicView.longestJobCurrentTop.map(row=>row.cleans),[7,6,5,4,3]);
 assert.deepEqual(publicView.longestJobHighestTop.map(row=>row.cleans),[7,6,5,4,3]);
 assert.ok(publicView.longestAllJobsCurrentTop.length<=5);
 assert.ok(publicView.longestAllJobsHighestTop.length<=5);
 const raw=JSON.stringify(publicView);
 assert.ok(!raw.includes("Helen"));
 for(const row of accounts)
   for(const value of [row.id,row.ref,row.jobs[0].id])
     assert.ok(!raw.includes('"'+value+'"'),"Leaked private value: "+value);
 // Removing a player from the public board must also remove that player
 // from records; the private Squeegee import alone never publishes names.
 const boardWithoutGina={...board,entries:board.entries.filter(row=>
   row.displayName!=="Gina")};
 const filtered=pub.highlights(snapshot,new Set(aliases),permissions,
   "overall",boardWithoutGina,previewKey);
 assert.equal(filtered.colours.find(row=>row.colour==="Black").currentTop[0].displayName,"Frank");
});
test("top five owner records are directly visible and keep town/year links",()=>{
 const owner=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/squeegeePreviewOwnerCustomers.mjs"),"utf8");
 assert.match(owner,/list\.slice\(0,5\)\.map/);
 assert.match(owner,/class="award-top-five"/);
 assert.match(owner,/TOP 5 RECORD HOLDERS/);
 assert.doesNotMatch(owner,/list\.length>1\?'<details>/);
 assert.match(owner,/url\(\{ref:item\.ref,view:"records",town,year\}\)/);
 const ui=fs.readFileSync(path.join(__dirname,
  "../src/components/ArcadeLeaderboard.jsx"),"utf8");
 assert.match(ui,/TopFiveCleanRecords/);
 assert.match(ui,/validTopFive\(row\.currentTop,row\.current\)/);
 assert.match(ui,/longestAllJobsHighestTop/);
 assert.match(ui,/{publicAchievements && <section/);
});

test("three public tabs keep Records separate from Leaderboards and protected Customer HQ",()=>{
 const ui=fs.readFileSync(path.join(__dirname,
  "../src/components/ArcadeLeaderboard.jsx"),"utf8");
 assert.match(ui,/onClick={openBoard}>★ LEADERBOARDS/);
 assert.match(ui,/onClick={openRecords}>★ RECORDS/);
 assert.match(ui,/onClick={openHQ}>★ CUSTOMER HQ/);
 assert.match(ui,/hidden={activePanel!=="records"}/);
 assert.match(ui,/hidden={activePanel!=="hq"}/);
 assert.match(ui,/setHqOpened\(true\)/);
 assert.match(ui,/n64-record-person/);
 assert.match(ui,/row\.points\.toLocaleString\("en-GB"\)\} XP/);
 assert.match(ui,/row\.cleans\.toLocaleString\("en-GB"\)/);
 assert.match(ui,/validTopFive\(row\.currentTop,row\.current\)/);
 const api=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/arcadeLeaderboard.js"),"utf8");
 assert.match(api,/if\(isExactN64PreviewRequest\(event\)\)/);
 const publicHelper=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/lib/squeegeePublicAchievementHighlights.js"),"utf8");
 assert.match(publicHelper,/status:"preview_public_named_records"/);
 assert.match(publicHelper,/\["preview_public_first_names","public_eligible_scores"\]\.includes\(publicScores\?\.status\)/);
 assert.match(publicHelper,/withdrawn\.has\(alias\)/);
});

test("Green and Brown share one top-five ranking without combining job streaks",()=>{
 const make=(id,ref,label,streak,firstName)=>({
  id,ref,firstName,town:"Bangor",paidCleans:streak,
  jobs:[{id:"job-"+ref,label,currentStreak:streak,lastCompletedOn:asOf,paidCleans:streak}],
  events:label.includes("+")?[paid(asOf,0,streak)]:
   Array.from({length:streak},(_,i)=>paid(
    new Date(Date.parse(asOf+"T12:00:00Z")-
      (streak-i-1)*28*86400000).toISOString().slice(0,10),0,i+1))
 });
 const brown=make("33333333-3333-4333-8333-333333333333","303","Brown",4,"Beth");
 const green=make("44444444-4444-4444-8444-444444444444","404","Green",7,"Gina");
 const mixed=make("55555555-5555-4555-8555-555555555555","505","Blue + Brown",30,"Mandy");
 const accounts=[brown,green,mixed];
 const ranked=award.awards(accounts,{asOf});
 assert.deepEqual(award.RECORD_CATEGORIES,["Black","Blue","Green & Brown"]);
 assert.deepEqual(ranked.byColour["Green & Brown"].map(r=>r.best),[7,4]);
 assert.deepEqual(ranked.byColourCurrent["Green & Brown"].map(r=>r.active),[7,4]);
 assert.deepEqual(ranked.byColour["Green & Brown"].map(r=>r.label),["Green","Brown"]);
 assert.ok(!ranked.byColour["Green & Brown"].some(r=>r.label==="Blue + Brown"));
 assert.equal(ranked.byColour.Green[0].best,7);
 assert.equal(ranked.byColour.Brown[0].best,4);
 assert.equal(ranked.longestJob[0].best,30);
 assert.equal(ranked.byColour["Green & Brown"][0].best,7); // not 7 + 4
 const y26=award.awards(accounts,{asOf,year:2026});
 assert.deepEqual(y26.byColour["Green & Brown"].map(r=>r.best),[7,4]);
 const aliases=accounts.map(r=>history.canonicalLegacyRef(r.id));
 const permissions={version:1,sourceAsOf:asOf,records:aliases.map(alias=>({alias,consent:"pending"}))};
 const board=publishedBoard(accounts,(_,i)=>[400,700,1500][i]);
 const pubView=pub.highlights({version:1,asOf,accounts},new Set(aliases),
  permissions,"2026",board,previewKey);
 assert.deepEqual(pubView.colours.map(c=>c.colour),["Black","Blue","Green & Brown"]);
 const combined=pubView.colours.find(c=>c.colour==="Green & Brown");
 assert.deepEqual(combined.currentTop.map(r=>r.cleans),[7,4]);
 assert.deepEqual(combined.highestTop.map(r=>r.displayName),["Gina","Beth"]);
 assert.deepEqual(combined.highestTop.map(r=>r.points),[700,400]);
 assert.ok(!JSON.stringify(pubView.colours).includes("Mandy"));
 const ui=fs.readFileSync(path.join(__dirname,
  "../src/components/ArcadeLeaderboard.jsx"),"utf8");
 assert.match(ui,/const colours=\["Black","Blue","Green & Brown"\]/);
 assert.match(ui,/records\.colours\.length===3/);
 assert.match(ui,/greenbrown/);
 const owner=fs.readFileSync(path.join(__dirname,
  "../netlify/functions/squeegeePreviewOwnerCustomers.mjs"),"utf8");
 assert.match(owner,/achievements\.RECORD_CATEGORIES\.map\(colour=>/);
 assert.match(owner,/award--.*GreenBrown/);
});

test("a 32-clean lifetime streak counts only the 12 verified 2026 visits",()=>{
 const calendar=Array.from({length:12},(_,i)=>paid(
  new Date(Date.parse("2026-01-01T12:00:00Z")+i*28*86400000)
   .toISOString().slice(0,10),0,i+21));
 assert.equal(calendar[11].date,"2026-11-05");
 const customer={
  ref:"3000",firstName:"Chris",town:"Donaghadee",paidCleans:32,
  jobs:[{id:"black-lifetime",label:"Black",currentStreak:32,
    lastCompletedOn:"2026-11-05",paidCleans:32}],
  // Deliberately out of order and with two services recorded for one date:
  // a yearly per-job streak is one attended VISIT per distinct day.
  events:[paid("2025-12-04",0,20),
    ...calendar.slice().reverse(),paid("2026-01-01",0,21,2),
    paid("2026-11-08",0,33)]
 };
 const original=JSON.stringify(customer);
 const all=award.awards([customer],{asOf});
 const annual=award.awards([customer],{asOf,year:2026});
 const year2025=award.awards([customer],{asOf,year:2025});
 assert.equal(all.byColour.Black[0].best,32);
 assert.equal(all.byColourCurrent.Black[0].active,32);
 assert.equal(annual.byColour.Black[0].best,12);
 assert.equal(annual.byColourCurrent.Black[0].active,12);
 assert.equal(annual.longestJob[0].best,12);
 assert.equal(annual.activeJob[0].active,12);
 assert.equal(annual.combined[0].combined,12);
 assert.equal(annual.combinedCurrent[0].activeCombined,12);
 assert.equal(year2025.byColour.Black[0].best,1);
 assert.equal(JSON.stringify(customer),original);
});

test("yearly current and highest streaks reset after skips, including unseen reset signals",()=>{
 const row={ref:"3001",firstName:"Ruth",town:"Bangor",paidCleans:9,
  jobs:[{id:"brown-year",label:"Brown",currentStreak:2,
    lastCompletedOn:"2026-11-06",paidCleans:9}],
  events:[
   paid("2025-12-30",0,26),
   paid("2026-01-27",0,27),
   paid("2026-02-24",0,28),
   skip("2026-03-24",0),
   paid("2026-04-21",0,1),
   paid("2026-05-19",0,2),
   paid("2026-06-16",0,3),
   // Original per-job counter dropping without a skip must also break the run.
   paid("2026-10-09",0,1),
   paid("2026-11-06",0,2)
  ]};
 const year=award.awards([row],{asOf,year:2026});
 assert.equal(year.byColour.Brown[0].best,3);
 assert.equal(year.byColourCurrent.Brown[0].active,2);
 assert.equal(year.combined[0].combined,5); // April, May, June, Oct and Nov unique dates
 assert.equal(year.combinedCurrent[0].activeCombined,5);
 assert.equal(year.paidBins[0].paidBins,7);
 const lifetime=award.awards([row],{asOf});
 assert.equal(lifetime.byColour.Brown[0].best,28);
 assert.equal(lifetime.byColourCurrent.Brown[0].active,2);
});

test("records use gold silver and bronze medals for ranks 1–3 only",()=>{
 const ui=fs.readFileSync(path.join(__dirname,
  "../src/components/ArcadeLeaderboard.jsx"),"utf8");
 const component=ui.slice(ui.indexOf("function TopFiveCleanRecords("),
  ui.indexOf("export default function ArcadeLeaderboard()"));
 assert.match(component,/i<3 && <span className="n64-record-medal"/);
 assert.match(component,/aria-label=\{\["Gold medal","Silver medal","Bronze medal"\]\[i\]\}/);
 assert.match(component,/\{\["🥇","🥈","🥉"\]\[i\]\}/);
 assert.match(component,/<span className="n64-record-person">/);
 assert.match(component,/<strong className="n64-record-rank-result">/);
 const css=fs.readFileSync(path.join(__dirname,
  "../src/n64-finale.css"),"utf8");
 assert.match(css,/\.n64-board-records-tab \.n64-record-medal/);
 assert.match(css,/\.n64-board-records-tab \.n64-record-rank-number/);
});

test("standard public XP leaderboard awards gold, silver and bronze only to the top three",()=>{
 const ui=fs.readFileSync(path.join(__dirname,
  "../src/components/ArcadeLeaderboard.jsx"),"utf8");
 const standard=ui.slice(ui.indexOf('<ol aria-label="Public leaderboard rankings">'),
  ui.indexOf("SHOW MORE PUBLIC SCORES"));
 assert.match(standard,/players\.slice\(0,publicShownCount\)\.map\(\(player, i\) =>/);
 assert.match(standard,/<strong>\{String\(i \+ 1\)\.padStart\(2, "0"\)\}<\/strong>/);
 assert.match(standard,/i<3 && <span className="n64-board-medal"/);
 assert.match(standard,/aria-label=\{\["Gold medal","Silver medal","Bronze medal"\]\[i\]\}/);
 assert.match(standard,/\{\["🥇","🥈","🥉"\]\[i\]\}/);
 assert.match(standard,/player\.points\.toLocaleString\("en-GB"\)\} XP/);
 assert.match(standard,/className="n64-board-player-button" onClick=\{openHQ\}/);
 const css=fs.readFileSync(path.join(__dirname,
  "../src/n64-finale.css"),"utf8");
 assert.match(css,/\.n64-rank-public \.n64-board-medal/);
 // The Records tab keeps its separate existing top-three medals.
 assert.match(ui,/i<3 && <span className="n64-record-medal"/);
});
