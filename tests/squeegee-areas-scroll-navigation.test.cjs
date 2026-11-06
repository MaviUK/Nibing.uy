"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const ROOT=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
const areaMount=fs.readFileSync(path.join(ROOT,"public/privacy-link.js"),"utf8");
const navigation=fs.readFileSync(path.join(ROOT,"public/n64-areas-navigation.js"),"utf8");
const menu=html.match(/<nav id="site-section-menu"[\s\S]*?<\/nav>/)?.[0];
assert.ok(menu);

const targets={
 "#what-we-do":"what-we-do",
 "#the-process":"the-process",
 "#bins-we-clean":"bins-we-clean",
 "#why-clean-your-bin":"why-clean-your-bin",
 "#why-ni-bin-guy":"why-ni-bin-guy",
 "#customer-reviews":"customer-reviews",
 "#wheelie-bin-cleaning-questions":"wheelie-bin-cleaning-questions",
 "#areas-we-cover":"areas-we-cover",
 "#customer-portal-login":"customer-portal-login",
 "#live-leaderboard":"live-leaderboard",
};

function browser({mounted=true,sectionTop=3800,headingTop=4020,hash="",
  pathname="/",width=390}={}){
  let present=mounted;
  let headingDocumentY=headingTop,sectionDocumentY=sectionTop,seq=0;
  const documentEvents=new Map(),windowEvents=new Map(),timers=new Map(),frames=new Map();
  const observers=[],scrolls=[],historyCalls=[];
  const location={pathname,search:"?ntl-drawer-state=hidden",hash};
  const section={
    getBoundingClientRect(){return {top:sectionDocumentY-window.scrollY};}
  };
  const heading={
    matches(s){assert.equal(s,"h1,h2");return true;},
    closest(s){assert.equal(s,"section");return section;},
    getBoundingClientRect(){return {top:headingDocumentY-window.scrollY};}
  };
  const root={
    querySelector(s){
      assert.ok(["h2,h1",".n64-board-tabs"].includes(s));
      return heading;
    },
    getBoundingClientRect(){return section.getBoundingClientRect();}
  };
  const document={
    readyState:"loading",
    documentElement:{style:{scrollBehavior:"smooth"}},
    addEventListener(name,fn){documentEvents.set(name,fn);},
    getElementById(id){
      if(!present || !Object.values(targets).includes(id))return null;
      return id==="customer-portal-login"?heading:root;
    }
  };
  const history={
    state:{some:"existing-history-state"},
    pushState(state,title,url){
      historyCalls.push({state,title,url});
      const i=url.indexOf("#");
      location.hash=i>=0?url.slice(i):"";
    },
  };
  const window={
    location,history,innerWidth:width,scrollY:1700,
    addEventListener(type,fn){
      if(!windowEvents.has(type))windowEvents.set(type,new Set());
      windowEvents.get(type).add(fn);
    },
    removeEventListener(type,fn){windowEvents.get(type)?.delete(fn);},
    setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,ms});return id;},
    clearTimeout(id){timers.delete(id);},
    requestAnimationFrame(fn){const id=++seq;frames.set(id,fn);return id;},
    cancelAnimationFrame(id){frames.delete(id);},
    scrollTo(a,b){
      const top=typeof a==="object"?a.top:b;
      scrolls.push({top,behavior:document.documentElement.style.scrollBehavior});
      window.scrollY=top;
    }
  };
  class MutationObserver{
    constructor(fn){this.fn=fn;this.disconnected=false;observers.push(this);}
    observe(target,options){
      assert.equal(target,document.documentElement);
      assert.equal(options.childList,true);
      assert.equal(options.subtree,true);
    }
    disconnect(){this.disconnected=true;}
  }
  vm.runInNewContext(navigation,{document,window,MutationObserver,Number,Math},{timeout:2000});
  return {
    document,window,location,historyCalls,scrolls,timers,observers,
    click(targetHash){
      let prevented=false,stopped=false;
      const link={getAttribute(name){
        assert.equal(name,"href");return targetHash;
      }};
      const event={
        button:0,defaultPrevented:false,
        target:{closest(selector){
          assert.equal(selector,'a[href^="#"]');
          return link;
        }},
        preventDefault(){prevented=true;this.defaultPrevented=true;},
        stopPropagation(){stopped=true;},
      };
      documentEvents.get("click")(event);
      return {prevented,stopped};
    },
    ready(){documentEvents.get("DOMContentLoaded")?.();},
    emit(type){for(const fn of [...(windowEvents.get(type)||[])])fn();},
    mount(y=headingDocumentY,top=sectionDocumentY){
      present=true;headingDocumentY=y;sectionDocumentY=top;
      for(const observer of observers)if(!observer.disconnected)observer.fn();
    },
    shift(y){headingDocumentY=y;},
    timer(ms){
      for(const [id,t] of [...timers])if(t.ms===ms){
        timers.delete(id);t.fn();
      }
    },
    scrollCount(){return scrolls.length;},
    headingVisibleY(){return headingDocumentY-window.scrollY;},
    stripeVisibleBottom(){return sectionDocumentY+(width<=600?64:80)-window.scrollY;},
    listenerCount(name){return windowEvents.get(name)?.size||0;}
  };
}

test("all ten menu sections are supported, with controls visible below the floating menu",()=>{
  for(const [hash,id] of Object.entries(targets)){
    const x=browser();
    const click=x.click(hash);
    assert.equal(click.prevented,true,hash+" custom scroll");
    assert.equal(click.stopped,false,hash+" existing menu closes");
    assert.equal(x.location.hash,hash);
    assert.equal(x.historyCalls.length,1);
    assert.equal(x.historyCalls[0].url,"/?ntl-drawer-state=hidden"+hash);
    assert.equal(x.scrolls[0].behavior,"auto");
    if(hash!=="#live-leaderboard")
      assert.ok(x.stripeVisibleBottom()<0,hash+" must not display the checkerboard");
    assert.equal(x.headingVisibleY(),
      hash==="#live-leaderboard"?74:122,
      hash+" first controls should be below the floating menu");
    assert.equal(x.document.documentElement.style.scrollBehavior,"smooth");
    assert.ok(menu.includes('href="'+hash+'"'),id+" must be in the actual website menu");
  }
});

test("short heading clearance still guarantees the checkerboard is entirely above the viewport",()=>{
  const x=browser({sectionTop:3910,headingTop:4020,width:390});
  x.click("#bins-we-clean");
  assert.equal(x.stripeVisibleBottom(),-3);
  assert.equal(x.headingVisibleY(),43,"stripe is skipped even with a short intro");
});

test("desktop navigation also lands below the larger four-row checkerboard",()=>{
  const x=browser({width:1280,sectionTop:3800,headingTop:4020});
  x.click("#why-ni-bin-guy");
  assert.equal(x.headingVisibleY(),108);
  assert.ok(x.stripeVisibleBottom()<0);
});

test("Areas We Cover waits for its dynamically inserted real section instead of stopping on Bins",()=>{
  const x=browser({mounted:false,sectionTop:5700,headingTop:5910});
  const click=x.click("#areas-we-cover");
  assert.equal(click.prevented,true);
  assert.equal(x.scrollCount(),0,"must not scroll to a wrong or missing element");
  assert.ok(x.observers.length>0);
  x.mount();
  assert.equal(x.headingVisibleY(),122);
  assert.ok(x.stripeVisibleBottom()<0);
  assert.equal(x.location.hash,"#areas-we-cover");
});

test("a newly loaded section can settle after React mounts and still align correctly",()=>{
  const x=browser();
  x.click("#wheelie-bin-cleaning-questions");
  assert.equal(x.headingVisibleY(),122);
  x.shift(4200);
  x.timer(240);
  assert.equal(x.headingVisibleY(),122);
  x.timer(2700);
  const count=x.scrollCount();
  x.shift(4600);
  x.timer(630);
  assert.equal(x.scrollCount(),count,"must stop re-positioning after navigation settles");
});

test("touch, wheel, pointer or keyboard interactions cancel delayed repositioning",()=>{
  for(const type of ["touchstart","wheel","pointerdown","keydown"]){
    const x=browser();
    x.click("#the-process");
    const before=x.scrollCount();
    x.emit(type);
    x.shift(4300);
    x.timer(240);
    assert.equal(x.scrollCount(),before,type);
    assert.equal(x.listenerCount(type),0);
  }
});

test("direct hash URLs wait until their own destination exists and scroll below checker",()=>{
  const x=browser({mounted:false,hash:"#areas-we-cover"});
  x.ready();
  assert.equal(x.scrollCount(),0);
  x.mount();
  assert.equal(x.headingVisibleY(),122);
  assert.equal(x.historyCalls.length,0);
  const portal=browser({mounted:false,hash:"#customer-portal-login"});
  portal.ready();
  portal.mount();
  assert.equal(portal.headingVisibleY(),122);
});

test("non-home URLs and unrelated hash links remain untouched",()=>{
  const x=browser();
  assert.equal(x.click("#unrelated-destination").prevented,false);
  assert.equal(x.scrollCount(),0);
  const y=browser({pathname:"/customer-hq"});
  assert.equal(y.click("#areas-we-cover").prevented,false);
  assert.equal(y.location.hash,"");
  assert.equal(y.scrollCount(),0);
});

test("menu and cache-busted assets preserve the real dynamic Areas section and normal animations",()=>{
  assert.match(areaMount,/var target=document\.getElementById\("customer-portal"\)/);
  assert.match(areaMount,/target\.parentNode\.insertBefore\(section,target\)/);
  assert.match(areaMount,/dispatchEvent\(new Event\("nbg:areas-mounted"\)\)/);
  assert.match(html,/src="\/n64-areas-navigation\.js\?v=20261103-leaderboard-top-fix"\s+defer/);
  assert.match(html,/src="\/privacy-link\.js\?v=20261104-covered-towns"\s+defer/);
  assert.match(html,/#site-section-menu a,\s*#site-section-menu button/);
  assert.match(html,/if \(event\.target\.closest\("a"\)\) closeMenu\(\)/);
  // Do not remove or hide the strips: customers still see completion
  // animations when naturally scrolling between all N64 levels.
  const css=fs.readFileSync(path.join(ROOT,"src/n64-square.css"),"utf8");
  assert.match(css,/--n64-check-height:calc\(var\(--n64-check-tile\) \* 4\)/);
  assert.match(css,/repeating-conic-gradient\(/);
});

test("Leaderboards menu and shared deep link land on the leaderboard tabs rather than the section boundary",()=>{
  const ui=fs.readFileSync(path.join(ROOT,"src/components/ArcadeLeaderboard.jsx"),"utf8");
  assert.match(ui,/id="live-leaderboard"/);
  assert.match(ui,/className="n64-board-tabs"/);
  const mobile=browser({sectionTop:3800,headingTop:4020,width:390});
  const clicked=mobile.click("#live-leaderboard");
  assert.equal(clicked.prevented,true);
  assert.equal(mobile.location.hash,"#live-leaderboard");
  assert.equal(mobile.headingVisibleY(),74);
  assert.ok(mobile.stripeVisibleBottom()<0);

  const deepLink=browser({mounted:false,hash:"#live-leaderboard"});
  deepLink.ready();
  assert.equal(deepLink.scrollCount(),0);
  deepLink.mount();
  assert.equal(deepLink.headingVisibleY(),74);

  const otherPage=browser({pathname:"/customer-hq"});
  assert.equal(otherPage.click("#live-leaderboard").prevented,false);
});

test("leaderboard tabs near its actual section top are never scrolled off-screen by an imaginary checkerboard",()=>{
  // On mobile the section has a 9px border and 52px top padding, NOT a
  // 4-row checker. The previous stripe clamp scrolled the tabs to -6px.
  const mobile=browser({sectionTop:3800,headingTop:3861,width:390});
  mobile.click("#live-leaderboard");
  assert.equal(mobile.window.scrollY,3787);
  assert.equal(mobile.headingVisibleY(),74);
  mobile.emit("resize");
  assert.equal(mobile.headingVisibleY(),74,"mobile address-bar resize preserves tab placement");

  const desktop=browser({sectionTop:3800,headingTop:3879,width:1280});
  desktop.click("#live-leaderboard");
  assert.equal(desktop.window.scrollY,3800);
  assert.equal(desktop.headingVisibleY(),79);

  for(const type of ["touchstart","wheel","pointerdown","keydown"]){
    const x=browser({sectionTop:3800,headingTop:3861,width:390});
    x.click("#live-leaderboard");
    const count=x.scrollCount();
    x.emit(type);
    x.shift(4000);
    x.emit("resize");
    x.timer(2200);
    assert.equal(x.scrollCount(),count,type+" cancels realignment");
  }
});
