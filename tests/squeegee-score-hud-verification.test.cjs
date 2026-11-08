"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const ROOT=path.resolve(__dirname,"..");
const scoreboard=fs.readFileSync(path.join(ROOT,"public/n64-scoreboard.js"),"utf8");
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function makeNode(){
  return {
    textContent:"",hidden:true,scrollTop:0,style:{},dataset:{},
    classList:{toggle(){},add(){},remove(){}},
    setAttribute(){},addEventListener(){},focus(){},
    appendChild(){},append(){},replaceChildren(){},
  };
}
function scoreboardInBrowser({getCustomerHQ,localXP=400}={}){
  const listeners=new Map(),nodes=new Map();
  const root=makeNode();
  root.querySelector=selector=>{
    if(!nodes.has(selector))nodes.set(selector,makeNode());
    return nodes.get(selector);
  };
  let start=()=>{throw Error("No DOM ready handler registered")};
  const document={
    readyState:"loading",visibilityState:"visible",
    cookie:"nbg_arcade_score_v1="+encodeURIComponent(JSON.stringify({
      v:1,xp:localXP,claimed:[],history:[],
    })),
    body:{appendChild(){}},
    createElement(tag){return tag==="aside"?root:makeNode();},
    querySelector(){return {};}, // style was already added
    addEventListener(name,cb){
      if(name==="DOMContentLoaded")start=cb;
    }
  };
  const window={
    addEventListener(name,handler){
      if(!listeners.has(name))listeners.set(name,[]);
      listeners.get(name).push(handler);
    },
    dispatchEvent(event){
      for(const handler of listeners.get(event.type)||[])handler(event);
    },
    setTimeout(){return 1;},clearTimeout(){},
    setInterval(){return 1;},clearInterval(){},
  };
  const requests=[];
  const fetch=(url,options={})=>{
    if(url==="/api/customer-hq"){
      requests.push(options);
      return getCustomerHQ();
    }
    if(url==="/.netlify/functions/arcadeLeaderboard")
      return Promise.resolve({
        ok:true,json:async()=>({status:"preview_public_first_names",entries:[]}),
      });
    throw Error("Unexpected URL: "+url);
  };
  const context={
    window,document,fetch,
    location:{pathname:"/",protocol:"https:"},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    Event:class{constructor(type){this.type=type;}},
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
    requestAnimationFrame(fn){fn();},
    console,
  };
  vm.runInNewContext(scoreboard,context,{filename:"n64-scoreboard.js"});
  start();
  return {
    window,requests,
    score:()=>nodes.get("[data-n64-score]").textContent,
    announce(points,customerReference=null,achievementState){
      window.dispatchEvent({type:"n64:account-score",
        detail:{points,customerReference,achievementState}});
    }
  };
}

test("verified Customer HQ total replaces phone-only XP in the star",async()=>{
  const h=scoreboardInBrowser({
    getCustomerHQ:async()=>({ok:true,json:async()=>({
      authenticated:true,account:{points:482},
    })})
  });
  assert.equal(h.score(),"400");
  await tick();
  assert.equal(h.score(),"482");
  assert.equal(h.window.n64Score.points(),482);
  assert.equal(h.requests[0].credentials,"same-origin");
  assert.equal(h.requests[0].cache,"no-store");
  h.announce(null);
  assert.equal(h.score(),"400");
  assert.equal(h.window.n64Score.points(),400);
});

test("new login wins over earlier in-flight logged-out API reply",async()=>{
  let firstResolve=null;
  let calls=0;
  const h=scoreboardInBrowser({
    getCustomerHQ:()=>{
      calls++;
      if(calls===1)return new Promise(resolve=>{firstResolve=resolve;});
      return Promise.resolve({ok:true,json:async()=>({
        authenticated:true,account:{points:482},
      })});
    },
  });
  assert.equal(h.score(),"400");
  h.announce(482);
  assert.equal(h.score(),"482");
  firstResolve({ok:true,json:async()=>({authenticated:false})});
  await tick();await tick();
  assert.equal(h.score(),"482","a previous guest response must not erase a verified total");
  assert.equal(calls,2,"the new account state must trigger a fresh fetch");
});

test("temporary customer API failures do not erase the last verified total",async()=>{
  let rejectFirst=null;
  const h=scoreboardInBrowser({
    getCustomerHQ:()=>new Promise((resolve,reject)=>{rejectFirst=reject;}),
  });
  h.announce(482);
  rejectFirst(new Error("offline"));
  await tick();await tick();
  assert.equal(h.score(),"482");
});

test("script URL is cache-busted and overrides generic Netlify JS caching",()=>{
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const toml=fs.readFileSync(path.join(ROOT,"netlify.toml"),"utf8");
  assert.match(html,/n64-scoreboard\.js\?v=20261101-cross-device-progress-5/);
  assert.match(toml,/for = "\/n64-scoreboard\.js"\s+\[headers\.values\]\s+Cache-Control = "no-store, no-cache, max-age=0, must-revalidate"/);
  const hq=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(hq,/new CustomEvent\("n64:account-score"/);
  assert.match(scoreboard,/accountRevision !== requestRevision/);
  assert.match(scoreboard,/accountRevision\s*\+=\s*1/);
});


test("a corrected lower XP total replaces duplicate-inflated points on the badge",async()=>{
  const h=scoreboardInBrowser({
    getCustomerHQ:async()=>({ok:true,json:async()=>({
      authenticated:true,account:{points:857,customerReference:"CUS123"}
    })})
  });
  const events=[];
  h.window.addEventListener("n64:verified-total",e=>events.push(e.detail));
  await tick();
  assert.equal(h.score(),"857");
  h.announce(907,"CUS123");
  assert.equal(h.score(),"907");
  // The backend has now reconciled the two November Level 01 records.
  // Its corrected verified 857 XP MUST replace the inflated 907.
  h.announce(857,"CUS123");
  assert.equal(h.score(),"857","a verified correction may decrease XP");
  h.window.dispatchEvent({type:"n64:request-verified-total"});
  assert.equal(events.at(-1).points,857);
  assert.equal(events.at(-1).customerReference,"CUS123");
});

test("a different verified customer replaces the previous account score",async()=>{
  const h=scoreboardInBrowser({
    getCustomerHQ:async()=>({ok:true,json:async()=>({
      authenticated:true,account:{points:907,customerReference:"CUS1"}
    })})
  });
  await tick();
  assert.equal(h.score(),"907");
  h.announce(857,"CUS1");
  assert.equal(h.score(),"857");
  h.announce(22,"CUS2");
  assert.equal(h.score(),"22","another account may start with a lower score");
  h.announce(null);
  assert.equal(h.score(),"400","logout returns to local XP");
});

test("the profile accepts corrected totals in both directions and refreshes dated history",()=>{
  const source=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(source,/n64:verified-total/);
  assert.match(source,/n64:request-verified-total/);
  assert.match(source,/verifiedSnapshotRef/);
  assert.match(source,/detail\.customerReference!==current\.customerReference/);
  // A smaller net score must not overwrite previously verified website rewards.
  assert.match(source,/const next=\{\.\.\.current,points:detail\.points\}/);
  assert.doesNotMatch(source,/websiteXp:Math\.max\(0,detail\.points-current\.cleaningPoints\)/);
  assert.match(source,/void refresh\(\)\.catch/);
  assert.match(scoreboard,/publishVerifiedTotal\(\)/);
});


test("website level XP is earned 01 to 08 in sequence, never by skipping forward",async()=>{
  const h=scoreboardInBrowser({
    getCustomerHQ:async()=>({ok:true,json:async()=>({authenticated:false})}),
    localXP:0,
  });
  const game=h.window.n64Score;
  assert.equal(game.levelStatus("what-we-do"),"pending");
  await tick(); // Guest mode is known only after Customer HQ auth resolves.
  const ids=["what-we-do","the-process","bins-we-clean","why-clean-your-bin",
    "why-ni-bin-guy","areas-we-cover","customer-portal","level-08-final"];
  assert.equal(game.levelStatus(ids[0]),"ready");
  assert.equal(game.levelStatus(ids[6]),"locked");
  assert.equal(game.awardLevel(ids[6]),false);
  assert.equal(game.awardLevel(ids[2]),false);
  assert.equal(game.points(),0);
  for(let i=0;i<ids.length;i++){
    assert.equal(game.levelStatus(ids[i]),"ready","level "+(i+1));
    assert.equal(game.awardLevel(ids[i]),true,"award level "+(i+1));
    assert.equal(game.awardLevel(ids[i]),false,"no duplicate level "+(i+1));
    assert.equal(game.points(),(i+1)*50);
  }
  assert.deepEqual(Array.from(game.activityEvents(),e=>e.key.split("@")[0]),
    ids.map(id=>"l:"+id));
});

test("completed visual level can be revisited when earlier checkpoints unlock it",()=>{
  const levelRun=fs.readFileSync(path.join(ROOT,"public/n64-level-run.js"),"utf8");
  assert.match(levelRun,/const pendingCredits = new Set\(\)/);
  assert.match(levelRun,/if\(status==="locked"\)\{/);
  assert.match(levelRun,/for\(const track of pendingCredits\)/);
  assert.match(levelRun,/creditCompletedLevel\(track\)/);
  assert.match(levelRun,/addEventListener\("n64:score-updated", scheduleCheck\)/);
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  assert.match(html,/n64-level-run\.js\?v=9-cross-device-progress/);
});


test("the profile must not reject valid lower totals after legacy XP is deduplicated",()=>{
  const hq=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  const hud=fs.readFileSync(path.join(ROOT,"public/n64-scoreboard.js"),"utf8");
  assert.match(hq,/const current=data\.account/);
  assert.match(hq,/detail\.points===current\.points/);
  assert.ok(!hq.includes("prior.points>data.account.points"));
  assert.ok(!hud.includes("fresh.points>=accountTotal"));
  assert.ok(!hud.includes("total>=accountTotal"));
  assert.match(hud,/accountTotal=fresh\.points/);
  assert.match(hud,/accountTotal=total/);
});


function ukNow(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return parts.year+"-"+parts.month+"-"+parts.day;
}
const IDS=["what-we-do","the-process","bins-we-clean","why-clean-your-bin",
  "why-ni-bin-guy","areas-we-cover","customer-portal","level-08-final"];
function remoteState(completed=IDS){
  const day=ukNow(),month=day.slice(0,7);
  return {
    month,day,
    earnedKeys:completed.map(id=>"l:"+id+"@"+month)
      .concat(["a:bin-checker","a:customer-portal@"+day])
  };
}

test("different phone inherits all eight completed levels after verified login",async()=>{
  const state=remoteState();
  const h=scoreboardInBrowser({
    localXP:0,
    getCustomerHQ:async()=>({ok:true,json:async()=>({
      authenticated:true,
      account:{points:607,customerReference:"CUS987",achievementState:state},
    })}),
  });
  const score=h.window.n64Score;
  assert.equal(score.levelStatus("what-we-do"),"pending",
    "cannot award anything until the account lookup finishes");
  assert.equal(score.awardLevel("what-we-do"),false);
  await tick();
  assert.equal(h.score(),"607");
  for(const id of IDS){
    assert.equal(score.levelStatus(id),"earned",id+" stays finished");
    assert.equal(score.awardLevel(id),false,id+" cannot pay XP again");
  }
  assert.equal(score.awardAction("bin-checker"),false);
  assert.equal(score.awardAction("customer-portal"),false);
  assert.equal(score.activityEvents().length,0,
    "the new phone is not given unearned local XP or duplicated records");
  assert.equal(score.points(),607,"account score is authoritative across phones");
});

test("partial completed account carries over and only the next level is eligible",async()=>{
  const h=scoreboardInBrowser({
    localXP:0,
    getCustomerHQ:async()=>({ok:true,json:async()=>({
      authenticated:true,account:{
        points:200,customerReference:"CUS123",
        achievementState:remoteState(IDS.slice(0,3)),
      }
    })})
  });
  await tick();
  const game=h.window.n64Score;
  for(let i=0;i<3;i++){
    assert.equal(game.levelStatus(IDS[i]),"earned");
    assert.equal(game.awardLevel(IDS[i]),false);
  }
  assert.equal(game.levelStatus(IDS[3]),"ready");
  assert.equal(game.levelStatus(IDS[4]),"locked");
  assert.equal(game.awardLevel(IDS[4]),false);
  assert.equal(game.awardLevel(IDS[3]),true);
  assert.equal(game.levelStatus(IDS[3]),"earned");
  assert.equal(game.levelStatus(IDS[4]),"ready");
  assert.equal(game.points(),200,"new local actions never inflate verified XP");
  assert.equal(game.activityEvents().length,1);
});

test("sign-out and switching customers clears the previous account's earned levels",async()=>{
  const h=scoreboardInBrowser({
    localXP:0,
    getCustomerHQ:async()=>({ok:true,json:async()=>({
      authenticated:true,account:{
        points:450,customerReference:"CUS1",achievementState:remoteState(),
      }
    })})
  });
  await tick();
  assert.equal(h.window.n64Score.levelStatus(IDS[0]),"earned");
  h.announce(null);
  assert.equal(h.window.n64Score.levelStatus(IDS[0]),"ready",
    "the previous customer's completion isn't copied into guest progress");
  h.announce(25,"CUS2",remoteState([]));
  assert.equal(h.window.n64Score.levelStatus(IDS[0]),"ready");
  assert.equal(h.window.n64Score.awardLevel(IDS[2]),false);
  assert.equal(h.window.n64Score.awardLevel(IDS[0]),true);
});

test("level animation waits for verified progress and marks remote-earned flags without replay",()=>{
  const source=fs.readFileSync(path.join(ROOT,"public/n64-level-run.js"),"utf8");
  assert.match(source,/function markAlreadyEarned\(track\)/);
  assert.match(source,/function onAchievementStateChanged\(\)/);
  assert.match(source,/addEventListener\("n64:achievement-state-changed"/);
  assert.match(source,/if\(status==="pending"\)return/);
  assert.match(source,/if\(status==="earned"\)\{markAlreadyEarned\(track\);continue;\}/);
  const hq=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(hq,/achievementState:current\.achievementState/);
  assert.match(scoreboard,/accountAchievementMode === "loading"|"loading"\)/);
  assert.match(scoreboard,/accountAchievementMode==="verified"&&accountEarnedKeys\.has\(key\)/);
});
