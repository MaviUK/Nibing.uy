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
    requestAnimationFrame(fn){fn();},
    console,
  };
  vm.runInNewContext(scoreboard,context,{filename:"n64-scoreboard.js"});
  start();
  return {
    window,requests,
    score:()=>nodes.get("[data-n64-score]").textContent,
    announce(points){window.dispatchEvent({type:"n64:account-score",detail:{points}});}
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
  assert.match(html,/n64-scoreboard\.js\?v=20261101-account-badge-2/);
  assert.match(toml,/for = "\/n64-scoreboard\.js"\s+\[headers\.values\]\s+Cache-Control = "no-store, no-cache, max-age=0, must-revalidate"/);
  const hq=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(hq,/new CustomEvent\("n64:account-score"/);
  assert.match(scoreboard,/accountRevision === requestRevision/);
  assert.match(scoreboard,/accountRevision \+= 1/);
});
