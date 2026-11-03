"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {canonicalLegacyRef}=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport");
const {ownerPrivateLeaderboardPreview}=require("../netlify/functions/lib/squeegeeOwnerLeaderboardPreview");
const {publicConsentBoard,NOTICE_VERSION}=require("../netlify/functions/lib/squeegeeLeaderboardNameConsent");
const {ENTRIES,AS_OF}=require("../netlify/functions/lib/squeegeeActivePreviewSnapshot");

const ID="12345678-1234-4123-8123-123456789abc",ALIAS=canonicalLegacyRef(ID);
const customer={
  id:ID,ref:"CUS1298",email:"test@example.co.uk",
  firstName:"Sarah",town:"Bangor",points:80
};
const el={aliases:new Set([ALIAS]),historicalPoints:80,count:1};
const privateData={asOf:AS_OF,accounts:[customer]};
const pending={
  records:[{alias:ALIAS,ref:"CUS1298",firstName:"Sarah",town:"Bangor",
    consent:"pending",consentAt:null,withdrawnAt:null,method:null,
    noticeVersion:null,evidenceRef:null}]
};
test("owner-only preview shows actual Squeegee customer ranks while pending consent",()=>{
  const p=ownerPrivateLeaderboardPreview(privateData,pending,el);
  assert.equal(p.count,1);
  assert.equal(p.verified,1);
  assert.equal(p.verifiedAsOf,AS_OF);
  assert.equal(p.approved,0);
  assert.equal(p.cleaningXp,80);
  assert.deepEqual(p.rows,[{rank:1,customerReference:"CUS1298",
    firstName:"Sarah",town:"Bangor",points:80,
    verification:"verified_from_squeegee_backup",permission:"pending"}]);
  assert.equal(ownerPrivateLeaderboardPreview(privateData,pending,null),null);
  assert.equal(ownerPrivateLeaderboardPreview(privateData,pending,{aliases:new Set(),historicalPoints:0}).count,0);
});
test("owner preview distinguishes approved and withdrawn; public still requires consent",()=>{
  const approved={records:[{...pending.records[0],firstName:"Saoirse",
    consent:"granted",consentAt:"2026-11-01T13:15:00Z",
    withdrawnAt:null,method:"email_reply",evidenceRef:"owner-proof-123",
    noticeVersion:NOTICE_VERSION}]};
  const a=ownerPrivateLeaderboardPreview(privateData,approved,el);
  assert.equal(a.approved,1);
  assert.equal(a.rows[0].firstName,"Saoirse");
  const withdrawn={records:[{...approved.records[0],consent:"withdrawn",
    withdrawnAt:"2026-11-01T13:20:00Z"}]};
  const b=ownerPrivateLeaderboardPreview(privateData,withdrawn,el);
  assert.equal(b.approved,0);
  assert.equal(b.verified,1);
  assert.equal(b.rows[0].verification,"verified_from_squeegee_backup");
  assert.equal(b.rows[0].permission,"withdrawn");
  const actualPublicSource={version:1,sourceAsOf:AS_OF,records:pending.records};
  const fullBoard={entries:[{rank:1,customerRef:ALIAS,town:"Bangor",points:80}],
    status:"squeegee_active_only"};
  assert.equal(publicConsentBoard(actualPublicSource,fullBoard,el.aliases).totalPlayers,0);
});
test("homepage leaderboard embeds customer sign-in as a switchable tab",()=>{
  const root=path.resolve(__dirname,"..");
  const board=fs.readFileSync(path.join(root,"src/components/ArcadeLeaderboard.jsx"),"utf8");
  const hq=fs.readFileSync(path.join(root,"src/pages/CustomerHQ.jsx"),"utf8");
  const css=fs.readFileSync(path.join(root,"src/n64-finale.css"),"utf8");
  assert.match(board,/activePanel/);
  assert.match(board,/My Customer HQ|MY CUSTOMER HQ/);
  assert.match(board,/<CustomerHQ embedded\s*\/>/);
  assert.match(board,/n64-board-tab-content/);
  assert.match(board,/hidden=\{activePanel!==/);
  assert.match(board,/const CustomerHQ=React.lazy\(\(\)=>import\("\.\.\/pages\/CustomerHQ"\)\)/);
  assert.match(hq,/function CustomerHQ\(\{embedded=false\}\)/);
  assert.match(hq,/n64:leaderboard-updated/);
  assert.match(hq,/const Container=embedded\?"div":"main"/);
  assert.match(css,/\.n64-board-tab-content\[hidden\]/);
  assert.match(board,/eligibleCleaningXp/);
  assert.match(board,/SHOW MORE PUBLIC SCORES/);
  assert.doesNotMatch(board,/Everyone can see the N64 test leaderboard by first name, town and points/);
});
test("owner private ranking cannot leak through public leaderboard; public API remains opt-in only",()=>{
  const root=path.resolve(__dirname,"..");
  const owner=fs.readFileSync(path.join(root,"netlify/functions/squeegeePreviewLeaderboardNames.mjs"),"utf8");
  const api=fs.readFileSync(path.join(root,"netlify/functions/arcadeLeaderboard.js"),"utf8");
  assert.match(owner,/verifyTestSessionCookie/);
  assert.match(owner,/ownerPrivateLeaderboardPreview/);
  assert.match(owner,/PRIVATE OWNER VIEW/);
  assert.match(owner,/no-store/);
  assert.doesNotMatch(api,/ownerPrivateLeaderboardPreview/);
  assert.match(api,/previewFirstNameScoreboard/);
  assert.match(api,/anonymous:true/);
  assert.match(api,/const annualCleaningTotal=annualYear===null\?eligible\.historicalPoints:/);
  assert.match(api,/eligibleCleaningXp:annualCleaningTotal/);
});


test("verified Squeegee membership is separate from public permission",()=>{
  const root=path.resolve(__dirname,"..");
  const verification=fs.readFileSync(path.join(root,"netlify/functions/lib/customerHQ.js"),"utf8");
  const api=fs.readFileSync(path.join(root,"netlify/functions/arcadeLeaderboard.js"),"utf8");
  const owner=fs.readFileSync(path.join(root,"netlify/functions/squeegeePreviewLeaderboardNames.mjs"),"utf8");
  assert.match(verification,/verificationStatus:"verified_from_squeegee_backup"/);
  assert.match(verification,/verifiedCount:aliases\.size/);
  assert.match(verification,/verifiedActiveEmailAccounts/);
  assert.match(api,/verifiedPlayers:eligible\.verifiedCount/);
  assert.match(api,/verifiedAsOf:eligible\.verificationAsOf/);
  assert.match(owner,/VERIFIED TOP 20/);
  assert.match(owner,/Waiting for permission/);
  assert.match(owner,/verifyTestSessionCookie/);
  const consent=fs.readFileSync(path.join(root,"netlify/functions/lib/squeegeeLeaderboardNameConsent.js"),"utf8");
  assert.match(consent,/r\.consent==="granted"/);
  assert.match(consent,/emailEligibleAliases\.has\(r\.alias\)/);
  assert.doesNotMatch(api,/r\.consent="granted"/);
});


test("sign-in CTA and both tabs anchor the TOP of the leaderboard after React changes panels",()=>{
  const root=path.resolve(__dirname,"..");
  const board=fs.readFileSync(path.join(root,"src/components/ArcadeLeaderboard.jsx"),"utf8");
  // The sign-in CTA and public name buttons must route to the same HQ panel.
  assert.match(board,/const openHQ = \(\) => selectPanel\("hq"\)/);
  assert.match(board,/onClick=\{openHQ\}>★ SIGN IN \/ VIEW MY CLEANING POINTS/);
  assert.match(board,/const openBoard = \(\) => \{\s*selectPanel\("leaderboard"\)/);
  assert.match(board,/ref=\{boardSectionRef\} id="live-leaderboard"/);
  assert.match(board,/ref=\{boardTabsRef\} className="n64-board-tabs"/);
  assert.match(board,/scrollOnPanelChange\.current = true;\s*setActivePanel\(panel\)/);
  assert.match(board,/useLayoutEffect\(\(\) => \{/);
  assert.match(board,/scrollToArcadeTabs\(boardTabsRef\.current\)/);
  assert.match(board,/stabilizeArcadeTabScroll\(boardTabsRef\.current,panel\)/);
  const css=fs.readFileSync(path.join(root,"src/n64-finale.css"),"utf8");
  assert.match(css,/\.n64-board-hq-tab:not\(\[hidden\]\)\s*\{\s*min-height:100svh;\s*min-height:100dvh;/);
  assert.ok(!board.includes("window.location.hash ="),
    "switching tabs should not leave a hash that affects later refreshes");
});

test("switching from a long public leaderboard to short Customer HQ scrolls to section start",async()=>{
  const {pathToFileURL}=require("node:url");
  const target=pathToFileURL(path.join(__dirname,
    "../src/components/scrollToArcadeBoardStart.mjs")).href;
  const {scrollToArcadeBoardStart}=await import(target);
  const calls=[];
  const viewport={
    scrollY:3800,
    scrollTo(arg){
      calls.push(arg);
      assert.equal(documentRef.documentElement.style.scrollBehavior,"auto",
        "global smooth-scrolling must be disabled while positioning");
    }
  };
  const documentRef={documentElement:{style:{scrollBehavior:"smooth"}}};
  const section={getBoundingClientRect(){return {top:-1525}}};
  assert.equal(scrollToArcadeBoardStart(section,viewport,documentRef),true);
  assert.deepEqual(calls,[{top:2275,left:0,behavior:"instant"}]);
  assert.equal(documentRef.documentElement.style.scrollBehavior,"smooth",
    "normal smooth section links should still work afterward");
});

test("the navigation helper supports old mobile scrollTo and no-op without a mounted section",async()=>{
  const {pathToFileURL}=require("node:url");
  const {scrollToArcadeBoardStart}=await import(pathToFileURL(path.join(__dirname,
    "../src/components/scrollToArcadeBoardStart.mjs")).href);
  const calls=[];
  const viewport={
    scrollY:800,
    scrollTo(...args){
      if(typeof args[0]==="object")throw new TypeError("unsupported options");
      calls.push(args);
    }
  };
  const documentRef={documentElement:{style:{scrollBehavior:"smooth"}}};
  assert.equal(scrollToArcadeBoardStart(null,viewport,documentRef),false);
  const section={getBoundingClientRect:()=>({top:-1200})};
  assert.equal(scrollToArcadeBoardStart(section,viewport,documentRef),true);
  assert.deepEqual(calls,[[0,0]],
    "scroll position clamps to top of document when section is above it");
  assert.equal(documentRef.documentElement.style.scrollBehavior,"smooth");
});


test("mobile switch anchors the actual tabs below floating menu rather than previous Book a Clean area",async()=>{
  const {pathToFileURL}=require("node:url");
  const {scrollToArcadeTabs}=await import(pathToFileURL(path.join(__dirname,
    "../src/components/scrollToArcadeBoardStart.mjs")).href);
  const calls=[];
  const view={scrollY:2000,innerWidth:384,
    scrollTo(value){calls.push(value);this.scrollY=value.top;}};
  const doc={documentElement:{style:{scrollBehavior:"smooth"}}};
  const absoluteTabsY=2475;
  const tabs={getBoundingClientRect:()=>({top:absoluteTabsY-view.scrollY})};
  assert.equal(scrollToArcadeTabs(tabs,view,doc),true);
  assert.deepEqual(calls,[{left:0,top:2414,behavior:"instant"}]);
  assert.equal(tabs.getBoundingClientRect().top,61,"tab row sits just below the fixed mobile header");
  assert.equal(doc.documentElement.style.scrollBehavior,"smooth");
});

test("Customer HQ lazy loading: re-align after short fallback stops clamping the scroll",async()=>{
  const {pathToFileURL}=require("node:url");
  const {stabilizeArcadeTabScroll}=await import(pathToFileURL(path.join(__dirname,
    "../src/components/scrollToArcadeBoardStart.mjs")).href);
  const calls=[],events=new Map(),timers=new Map();
  let nextId=0,resize=null,mutation=null;
  const absoluteTabsY=2500;
  let limit=2030;
  const view={
    innerWidth:384,scrollY:1940,
    scrollTo({top}){this.scrollY=Math.min(limit,top);calls.push(this.scrollY);},
    requestAnimationFrame(cb){timers.set(++nextId,cb);return nextId;},
    cancelAnimationFrame(id){timers.delete(id);},
    setTimeout(cb){timers.set(++nextId,cb);return nextId;},
    clearTimeout(id){timers.delete(id);},
    ResizeObserver:class{
      constructor(cb){resize=cb;}
      observe(node){assert.equal(node,panel);}
      disconnect(){}
    },
    MutationObserver:class{
      constructor(cb){mutation=cb;}
      observe(node){assert.equal(node,panel);}
      disconnect(){}
    },
    addEventListener(name,cb){events.set(name,cb);},
    removeEventListener(name){events.delete(name);},
  };
  const tabs={getBoundingClientRect:()=>({top:absoluteTabsY-view.scrollY})};
  const panel={};
  const doc={documentElement:{style:{scrollBehavior:"smooth",overflowAnchor:"auto"}}};
  const cancel=stabilizeArcadeTabScroll(tabs,panel,view,doc);
  assert.equal(view.scrollY,2030,"short loading fallback clamps at max scroll position");
  assert.equal(doc.documentElement.style.overflowAnchor,"none");
  limit=3600; // React.lazy has now mounted the real authenticated Customer HQ.
  resize();
  assert.equal(view.scrollY,2439,"after HQ loads, the tab row aligns to viewport top");
  assert.equal(tabs.getBoundingClientRect().top,61);
  assert.ok(typeof mutation==="function");
  cancel();
  assert.equal(doc.documentElement.style.overflowAnchor,"auto");
  assert.equal(events.size,0);
});

test("after a customer touches the page, late Customer HQ hydration cannot yank them back to tabs",async()=>{
  const {pathToFileURL}=require("node:url");
  const {stabilizeArcadeTabScroll}=await import(pathToFileURL(path.join(__dirname,
    "../src/components/scrollToArcadeBoardStart.mjs")).href);
  let onResize=null;const events=new Map(),calls=[];
  const view={
    innerWidth:384,scrollY:300,
    scrollTo({top}){calls.push(top);this.scrollY=top;},
    setTimeout(){return 1;},clearTimeout(){},
    ResizeObserver:class{constructor(cb){onResize=cb;} observe(){} disconnect(){}},
    addEventListener(name,cb){events.set(name,cb);},
    removeEventListener(name){events.delete(name);},
  };
  const doc={documentElement:{style:{scrollBehavior:"smooth",overflowAnchor:"auto"}}};
  const tabs={getBoundingClientRect:()=>({top:200})};
  const cancel=stabilizeArcadeTabScroll(tabs,{},view,doc);
  assert.equal(calls.length,1);
  events.get("touchstart")();
  onResize();
  assert.equal(calls.length,1,"a real touch gesture cancels delayed auto-scroll");
  assert.equal(doc.documentElement.style.overflowAnchor,"auto");
  cancel();
});
