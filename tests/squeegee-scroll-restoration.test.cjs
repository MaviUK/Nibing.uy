"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const script=html.match(/<script data-nbg-refresh-scroll>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,"head scroll reset must be present before the Vite app loads");
assert.ok(html.indexOf("data-nbg-refresh-scroll")<html.indexOf('src="/src/main.jsx"'),
  "reload scroll prevention must run before the SPA mounts");

function browser(type,{pathname="/",hash="",search="?ntl-drawer-state=hidden",
  performanceEntry=true,oldNavigationType}={}){
  const scrolled=[],replacements=[],frames=[],events={};
  const location={pathname,hash,search};
  const history={
    state:{keep:"state"},scrollRestoration:"auto",
    replaceState(state,title,url){
      replacements.push({state,title,url});
      const parsed=new URL(url,"https://example.netlify.app");
      location.pathname=parsed.pathname;
      location.hash=parsed.hash;
      location.search=parsed.search;
    }
  };
  const root={style:{scrollBehavior:"smooth"}};
  const document={
    documentElement:root,
    addEventListener(event,fn){events["document:"+event]=fn;},
  };
  const window={
    location,history,
    performance:{
      getEntriesByType(){return performanceEntry?[{type}]:[];},
      navigation:{type:oldNavigationType??(type==="reload"?1:0)},
    },
    scrollTo(x,y){scrolled.push({x,y,behavior:root.style.scrollBehavior});},
    requestAnimationFrame(fn){frames.push(fn);},
    addEventListener(event,fn){events["window:"+event]=fn;}
  };
  vm.runInNewContext(script,{window,document,URL},{timeout:2000});
  return {window,history,location,scrolled,replacements,frames,events,
    flush(){
      while(frames.length)frames.shift()();
    }
  };
}

test("refresh at the top stays at the top, including after React is ready",()=>{
  const x=browser("reload");
  assert.equal(x.scrolled.length,1);
  assert.deepEqual(x.scrolled[0],{x:0,y:0,behavior:"auto"});
  assert.equal(x.history.scrollRestoration,"manual");
  x.events["document:DOMContentLoaded"]();
  x.flush();
  x.events["window:pageshow"]();
  x.flush();
  assert.ok(x.scrolled.length>=5);
  assert.ok(x.scrolled.every(p=>p.x===0&&p.y===0&&p.behavior==="auto"));
  assert.equal(x.history.scrollRestoration,"auto","back/forward remains normal");
});

test("refresh clears an old homepage section fragment but preserves preview query parameters",()=>{
  const x=browser("reload",{
    pathname:"/",hash:"#live-leaderboard",
    search:"?ntl-drawer-state=hidden&owner-board=1",
  });
  assert.equal(x.location.hash,"");
  assert.deepEqual(x.replacements.map(v=>v.url),
    ["/?ntl-drawer-state=hidden&owner-board=1"]);
  assert.deepEqual(x.replacements[0].state,{keep:"state"});
  assert.ok(x.scrolled.length>=1);
});

test("the customer portal stays put on a newly opened deep link rather than getting reset",()=>{
  const x=browser("navigate",{hash:"#customer-portal-login"});
  assert.equal(x.location.hash,"#customer-portal-login");
  assert.equal(x.scrolled.length,0);
  assert.equal(x.replacements.length,0);
  assert.equal(x.history.scrollRestoration,"auto");
  // The portal's existing scrollIntoView effect still handles the link.
  const portal=fs.readFileSync(path.join(__dirname,"../src/components/CustomerPortalLoader.jsx"),"utf8");
  assert.match(portal,/document\.getElementById\("customer-portal-login"\)\?\.scrollIntoView/);
});

test("back/forward browsing keeps the phone's previous scroll position",()=>{
  const x=browser("back_forward",{hash:"#live-leaderboard"});
  assert.equal(x.scrolled.length,0);
  assert.equal(x.replacements.length,0);
  assert.equal(x.history.scrollRestoration,"auto");
});

test("reload reset also works on public booking and customer pages",()=>{
  for(const pathname of ["/","/customer-hq","/squeegee-portal","/street-booking/"]){
    const x=browser("reload",{pathname,hash:"#customer-portal-login"});
    assert.ok(x.scrolled.length>=1,pathname);
    assert.equal(x.location.hash,"");
  }
});

test("do not alter private admin routes or OAuth callback fragments",()=>{
  for(const pathname of ["/auth/callback","/admin","/standee/test/claim"]){
    const x=browser("reload",{pathname,hash:"#access_token=some-value"});
    assert.equal(x.scrolled.length,0,pathname);
    assert.equal(x.replacements.length,0,pathname);
    assert.equal(x.location.hash,"#access_token=some-value");
  }
});

test("older Android browsers can fall back to legacy navigation type for refreshes",()=>{
  const x=browser("reload",{performanceEntry:false,oldNavigationType:1});
  assert.equal(x.scrolled.length,1);
  assert.equal(x.history.scrollRestoration,"manual");
});
