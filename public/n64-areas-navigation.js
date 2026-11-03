/*
 * N64 preview: section links enter AFTER the four-row checkerboard.
 *
 * The stripe belongs to the beginning of each section. Browser-native hash
 * scrolling positions that stripe at the top of the mobile viewport. Instead,
 * scroll to the section heading, keeping it visible below the floating menu.
 * The generated Areas We Cover section is inserted after React mounts; wait
 * for the real target instead of stopping on another section.
 */
(function(){
  "use strict";
  var TARGETS={
    "#what-we-do":"what-we-do",
    "#the-process":"the-process",
    "#bins-we-clean":"bins-we-clean",
    "#why-clean-your-bin":"why-clean-your-bin",
    "#why-ni-bin-guy":"why-ni-bin-guy",
    "#customer-reviews":"customer-reviews",
    "#wheelie-bin-cleaning-questions":"wheelie-bin-cleaning-questions",
    "#areas-we-cover":"areas-we-cover",
    "#customer-portal-login":"customer-portal-login",
    "#customer-portal":"customer-portal",
    "#live-leaderboard":"live-leaderboard"
  };
  var stopPrevious=function(){};
  function homepage(){
    return window.location.pathname==="/"||window.location.pathname==="";
  }
  function targetHeading(hash){
    var id=TARGETS[hash];
    if(!id)return null;
    var el=document.getElementById(id);
    if(!el)return null;
    // The leaderboard tabs are the first useful controls after the section
    // boundary. Scroll to them rather than the checkered line or title below.
    if(hash==="#live-leaderboard")
      return el.querySelector(".n64-board-tabs")||el.querySelector("h2,h1")||el;
    if(el.matches&&el.matches("h1,h2"))return el;
    return el.querySelector("h2,h1")||el;
  }
  function alignAfterChecker(hash){
    var heading=targetHeading(hash);
    if(!heading)return false;
    var rect=heading.getBoundingClientRect();
    if(!Number.isFinite(rect.top))return false;
    var current=window.scrollY||window.pageYOffset||0;
    var mobile=window.innerWidth<=600;
    // Title sits below the floating header; opening a section from the menu
    // should not first show its checkered finish line.
    var titleOffset=mobile?122:108;
    var destination=Math.max(0,Math.round(current+rect.top-titleOffset));
    var section=heading.closest?heading.closest("section"):null;
    if(section&&section.getBoundingClientRect){
      // Four checker rows: mobile 16px each, desktop 20px each. Never land
      // before their bottom edge even when a section has a short heading.
      var stripeHeight=mobile?64:80;
      var sectionTop=section.getBoundingClientRect().top;
      if(Number.isFinite(sectionTop)){
        destination=Math.max(destination,
          Math.max(0,Math.ceil(current+sectionTop+stripeHeight+3)));
      }
    }
    var root=document.documentElement;
    var oldBehavior=root.style.scrollBehavior;
    root.style.scrollBehavior="auto";
    try{
      try{window.scrollTo({top:destination,left:0,behavior:"instant"});}
      catch(_){window.scrollTo(0,destination);}
    }finally{
      root.style.scrollBehavior=oldBehavior;
    }
    return true;
  }
  function focusSection(hash){
    stopPrevious();
    if(!homepage()||!TARGETS[hash])return;
    var active=true,observer=null,found=false;
    var timers=[],frames=[];
    var manualEvents=["touchstart","wheel","pointerdown","keydown"];
    function stop(){
      if(!active)return;
      active=false;
      if(observer)observer.disconnect();
      for(var i=0;i<timers.length;i++)window.clearTimeout(timers[i]);
      for(var k=0;k<frames.length;k++)window.cancelAnimationFrame?.(frames[k]);
      for(var j=0;j<manualEvents.length;j++)
        window.removeEventListener(manualEvents[j],stop);
    }
    stopPrevious=stop;
    function schedule(fn,ms){timers.push(window.setTimeout(fn,ms));}
    function realign(){
      if(!active)return;
      if(!homepage()||window.location.hash!==hash){stop();return;}
      if(!alignAfterChecker(hash))return;
      if(!found){
        found=true;
        if(observer){observer.disconnect();observer=null;}
        // A newly mounted React section or Squeegee widget may still move
        // after its first paint. Re-position briefly, then leave scroll
        // entirely to the customer.
        for(var i=0;i<3;i++)schedule(realign,[70,240,630][i]);
        if(typeof window.requestAnimationFrame==="function"){
          frames.push(window.requestAnimationFrame(function(){
            realign();
            frames.push(window.requestAnimationFrame(realign));
          }));
        }
        schedule(stop,1250);
      }
    }
    for(var i=0;i<manualEvents.length;i++)
      window.addEventListener(manualEvents[i],stop,{passive:true});
    realign();
    if(!found&&typeof MutationObserver==="function"){
      observer=new MutationObserver(realign);
      observer.observe(document.documentElement,{childList:true,subtree:true});
    }
    // Some content arrives late (React.lazy, customer login or generated
    // area links). Never guess a destination while it is missing.
    for(var j=0;j<6;j++)schedule(realign,[40,170,490,1050,2250,4200][j]);
    schedule(stop,6200);
  }
  document.addEventListener("click",function(event){
    var link=event.target&&event.target.closest&&
      event.target.closest('a[href^="#"]');
    if(!link||!homepage()||event.defaultPrevented ||
       event.button>0||event.metaKey||event.ctrlKey||
       event.altKey||event.shiftKey)return;
    var hash=link.getAttribute("href");
    if(!TARGETS[hash])return;
    // Let the existing menu click handler close the menu. Prevent only
    // the native hash jump (which would land on the checkerboard).
    event.preventDefault();
    if(window.location.hash!==hash){
      window.history.pushState(window.history.state,"",
        window.location.pathname+window.location.search+hash);
    }
    focusSection(hash);
  },true);
  window.addEventListener("nbg:areas-mounted",function(){
    if(homepage()&&window.location.hash==="#areas-we-cover")
      focusSection("#areas-we-cover");
  });
  // Browser address-bar hashes, including direct shared links, work even
  // when React has not inserted the destination yet.
  window.addEventListener("hashchange",function(){
    if(homepage()&&TARGETS[window.location.hash])
      focusSection(window.location.hash);
  });
  function onLoad(){
    if(homepage()&&TARGETS[window.location.hash])
      focusSection(window.location.hash);
  }
  if(document.readyState==="loading")
    document.addEventListener("DOMContentLoaded",onLoad,{once:true});
  else onLoad();
})();
