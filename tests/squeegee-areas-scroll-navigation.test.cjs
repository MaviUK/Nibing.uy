"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const ROOT=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
const mountSource=fs.readFileSync(path.join(ROOT,"public/privacy-link.js"),"utf8");
const navSource=fs.readFileSync(path.join(ROOT,"public/n64-areas-navigation.js"),"utf8");

function simulate({sectionMounted=true,hash="",pathname="/",innerWidth=390,
  headingY=4100}={}){
  const documentEvents=new Map(),windowEvents=new Map(),scrolls=[],historyCalls=[];
  const timers=new Map(),observers=[];
  let timerId=0,exists=sectionMounted,headingTop=headingY;
  const document={
    readyState:"loading",
    documentElement:{style:{scrollBehavior:"smooth"}},
    addEventListener(name,fn){documentEvents.set(name,fn);},
    getElementById(id){
      if(id!=="areas-we-cover"||!exists)return null;
      return {querySelector(selector){
        assert.equal(selector,"h2");
        return {getBoundingClientRect:()=>({top:headingTop-window.scrollY})};
      }};
    }
  };
  const location={pathname,hash,search:"?ntl-drawer-state=hidden"};
  const history={
    state:{remember:"menu"},
    pushState(state,title,fragment){
      historyCalls.push({state,title,fragment});
      location.hash=fragment;
    }
  };
  const window={
    location,history,innerWidth,scrollY:1777,
    addEventListener(name,fn){if(!windowEvents.has(name))windowEvents.set(name,new Set());windowEvents.get(name).add(fn);},
    removeEventListener(name,fn){windowEvents.get(name)?.delete(fn);},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},
    clearTimeout(id){timers.delete(id);},
    scrollTo(arg1,arg2){
      const top=typeof arg1==="object"?arg1.top:arg2;
      scrolls.push({top,behavior:document.documentElement.style.scrollBehavior});
      window.scrollY=top;
    },
  };
  class MutationObserver{
    constructor(fn){this.fn=fn;this.disconnected=false;observers.push(this);}
    observe(element,options){assert.equal(element,document.documentElement);assert.equal(options.subtree,true);}
    disconnect(){this.disconnected=true;}
  }
  vm.runInNewContext(navSource,{window,document,MutationObserver,Number,Math},{timeout:2000});
  return {
    window,document,location,scrolls,historyCalls,timers,observers,
    clickAreas(){
      let prevented=false,stopped=false;
      const click={
        target:{closest(selector){
          assert.equal(selector,'#site-section-menu a[href="#areas-we-cover"]');
          return {};
        }},
        preventDefault(){prevented=true;},
        stopPropagation(){stopped=true;},
      };
      documentEvents.get("click")(click);
      return {prevented,stopped};
    },
    clickElsewhere(){
      let prevented=false;
      documentEvents.get("click")({
        target:{closest(){return null;}},
        preventDefault(){prevented=true;},
      });
      return prevented;
    },
    dispatchWindow(event){
      for(const fn of [...(windowEvents.get(event)||[])])fn();
    },
    domReady(){documentEvents.get("DOMContentLoaded")?.();},
    mount(nextY){
      if(Number.isFinite(nextY))headingTop=nextY;
      exists=true;
      this.dispatchWindow("nbg:areas-mounted");
      for(const obs of observers)if(!obs.disconnected)obs.fn();
    },
    changeLayout(nextY){headingTop=nextY;},
    runTimer(ms){
      const tasks=[...timers].filter(([,timer])=>timer.ms===ms);
      for(const [id,timer] of tasks){timers.delete(id);timer.fn();}
    },
    getHeadingTop(){return headingTop-window.scrollY;},
    getLiveListeners(name){return windowEvents.get(name)?.size||0;},
  };
}

test("Areas We Cover is inserted directly BEFORE the mounted Customer Portal, never before Questions",()=>{
  assert.match(mountSource,/var target=document\.getElementById\("customer-portal"\)/);
  assert.doesNotMatch(mountSource,/target=portal\|\|questions/);
  assert.match(mountSource,/target\.parentNode\.insertBefore\(section,target\)/);
  assert.match(mountSource,/dispatchEvent\(new Event\("nbg:areas-mounted"\)\)/);
  assert.match(mountSource,/new MutationObserver\(addAreasSection\)/);
});

test("menu click jumps to Areas heading, not Reviews/Questions, and preserves normal menu closing",()=>{
  const page=simulate({headingY:4100});
  const result=page.clickAreas();
  assert.equal(result.prevented,true,"native hash scrolling must not run early");
  assert.equal(result.stopped,false,"existing menu listener can still close the menu");
  assert.equal(page.location.hash,"#areas-we-cover");
  assert.equal(page.historyCalls.length,1);
  assert.equal(page.scrolls.length,1);
  assert.equal(page.scrolls[0].top,3988);
  assert.equal(page.scrolls[0].behavior,"auto");
  assert.equal(page.getHeadingTop(),112,"heading stays below fixed mobile menu");
  assert.equal(page.document.documentElement.style.scrollBehavior,"smooth");
});

test("menu link clicked BEFORE React mounts the Areas section waits until it actually exists",()=>{
  const page=simulate({sectionMounted:false,headingY:5000});
  page.clickAreas();
  assert.equal(page.scrolls.length,0,"never guess the scroll destination");
  assert.ok(page.observers.length>0,"watch for the inserted section");
  page.mount();
  assert.ok(page.scrolls.length>=1);
  assert.equal(page.getHeadingTop(),112);
  assert.ok(page.observers.every(o=>o.disconnected));
});

test("layout changes after the initial click are corrected, then monitoring ends",()=>{
  const page=simulate({headingY:4000});
  page.clickAreas();
  assert.equal(page.getHeadingTop(),112);
  page.changeLayout(4300); // a later React/component or font layout shift
  page.runTimer(300);
  assert.equal(page.getHeadingTop(),112);
  page.runTimer(1800);
  const count=page.scrolls.length;
  page.changeLayout(4600);
  page.runTimer(700);
  assert.equal(page.scrolls.length,count,"must stop repositioning after initial navigation");
});

test("user touching or scrolling stops delayed automatic re-positioning",()=>{
  const page=simulate({headingY:4100});
  page.clickAreas();
  const before=page.scrolls.length;
  page.dispatchWindow("touchstart");
  assert.equal(page.getLiveListeners("touchstart"),0);
  page.changeLayout(4400);
  page.runTimer(300);
  assert.equal(page.scrolls.length,before);
});

test("a fresh direct #areas-we-cover link waits for lazy section insertion",()=>{
  const page=simulate({sectionMounted:false,hash:"#areas-we-cover",headingY:4400});
  page.domReady();
  assert.equal(page.scrolls.length,0);
  page.mount();
  assert.equal(page.getHeadingTop(),112);
  assert.equal(page.historyCalls.length,0);
});

test("normal menu links, non-home routes and non-area hashes keep their existing behavior",()=>{
  const page=simulate({headingY:4000});
  assert.equal(page.clickElsewhere(),false);
  assert.equal(page.scrolls.length,0);
  const other=simulate({pathname:"/customer-hq"});
  assert.equal(other.clickAreas().prevented,false);
  assert.equal(other.scrolls.length,0);
  assert.equal(other.historyCalls.length,0);
});

test("menu and cache-busted navigation assets are part of the actual N64 HTML build",()=>{
  assert.match(html,/<a href="#areas-we-cover">Areas We Cover<\/a>/);
  assert.match(html,/src="\/privacy-link\.js\?v=20261101-areas-after-portal"\s+defer/);
  assert.match(html,/src="\/n64-areas-navigation\.js\?v=20261101-area-scroll-fix-1"\s+defer/);
  assert.ok(html.indexOf("privacy-link.js?v=20261101-areas-after-portal")<
    html.indexOf("n64-areas-navigation.js?v=20261101-area-scroll-fix-1"));
});
