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
    announce(points,customerReference=null){
      window.dispatchEvent({type:"n64:account-score",detail:{points,customerReference}});
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
  assert.match(html,/n64-scoreboard\.js\?v=20261101-verified-level-sequence-3/);
  assert.match(toml,/for = "\/n64-scoreboard\.js"\s+\[headers\.values\]\s+Cache-Control = "no-store, no-cache, max-age=0, must-revalidate"/);
  const hq=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(hq,/new CustomEvent\("n64:account-score"/);
  assert.match(scoreboard,/accountRevision !== requestRevision/);
  assert.match(scoreboard,/accountRevision\s*\+=\s*1/);
});


test("a newer verified 907 XP total is shared with the Customer HQ profile",async()=>{
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
  h.announce(857,"CUS123");
  assert.equal(h.score(),"907","an outdated Customer HQ total cannot demote the badge");
  assert.equal(events.at(-1).points,907);
  assert.equal(events.at(-1).customerReference,"CUS123");
  h.window.dispatchEvent({type:"n64:request-verified-total"});
  assert.equal(events.at(-1).points,907);
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
  assert.equal(h.score(),"907");
  h.announce(22,"CUS2");
  assert.equal(h.score(),"22","another account may start with a lower score");
  h.announce(null);
  assert.equal(h.score(),"400","logout returns to local XP");
});

test("the profile subscribes to newer verified totals and refreshes dated history",()=>{
  const source=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(source,/n64:verified-total/);
  assert.match(source,/n64:request-verified-total/);
  assert.match(source,/verifiedSnapshotRef/);
  assert.match(source,/detail\.customerReference!==current\.customerReference/);
  assert.match(source,/websiteXp:Math\.max\(0,detail\.points-current\.cleaningPoints\)/);
  assert.match(source,/void refresh\(\)\.catch/);
  assert.match(scoreboard,/publishVerifiedTotal\(\)/);
});


test("website level XP is earned 01 to 08 in sequence, never by skipping forward",()=>{
  const h=scoreboardInBrowser({
    getCustomerHQ:async()=>({ok:true,json:async()=>({authenticated:false})}),
    localXP:0,
  });
  const game=h.window.n64Score;
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
  assert.match(html,/n64-level-run\.js\?v=8-ordered-rewards/);
});
