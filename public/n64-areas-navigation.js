/*
 * N64 preview: make the Areas We Cover menu jump reliable on Android.
 * The areas section is inserted after React mounts the Customer Portal.
 * Native #hash scrolling can run before that section exists and leave
 * the customer in Customer Reviews / Questions instead.
 */
(function(){
  "use strict";
  var TARGET_HASH="#areas-we-cover";
  var MENU_LINK='#site-section-menu a[href="#areas-we-cover"]';
  var abortPrevious=function(){};
  function onHomepage(){
    return window.location.pathname==="/" || window.location.pathname==="";
  }
  function alignHeading(section){
    var heading=section&&section.querySelector("h2");
    if(!heading)return false;
    var rect=heading.getBoundingClientRect();
    if(!Number.isFinite(rect.top))return false;
    var offset=window.innerWidth<=600?112:96;
    var y=Math.max(0,Math.round((window.scrollY||window.pageYOffset||0)+rect.top-offset));
    var root=document.documentElement;
    var previous=root.style.scrollBehavior;
    root.style.scrollBehavior="auto";
    try{
      try{window.scrollTo({top:y,left:0,behavior:"instant"});}
      catch(_){window.scrollTo(0,y);}
    }finally{
      root.style.scrollBehavior=previous;
    }
    return true;
  }
  function focusAreas(){
    abortPrevious();
    if(!onHomepage())return;
    var active=true,observer=null,hadSection=false;
    var timers=[];
    var manualEvents=["touchstart","wheel","pointerdown","keydown"];
    function stop(){
      if(!active)return;
      active=false;
      if(observer)observer.disconnect();
      for(var i=0;i<timers.length;i++)window.clearTimeout(timers[i]);
      for(var j=0;j<manualEvents.length;j++)
        window.removeEventListener(manualEvents[j],stop);
    }
    abortPrevious=stop;
    function position(){
      if(!active)return;
      if(!onHomepage()||window.location.hash!==TARGET_HASH){stop();return;}
      var section=document.getElementById("areas-we-cover");
      if(!section)return;
      if(alignHeading(section)){
        hadSection=true;
        if(observer){observer.disconnect();observer=null;}
      }
    }
    for(var i=0;i<manualEvents.length;i++)
      window.addEventListener(manualEvents[i],stop,{passive:true});
    position();
    if(!hadSection&&typeof MutationObserver==="function"){
      observer=new MutationObserver(position);
      observer.observe(document.documentElement,{childList:true,subtree:true});
    }
    // Recheck as React, fonts and the generated section settle.
    for(var k=0;k<5;k++){
      var delay=[30,120,300,700,1400][k];
      timers.push(window.setTimeout(position,delay));
    }
    timers.push(window.setTimeout(stop,1800));
  }
  document.addEventListener("click",function(event){
    var link=event.target&&event.target.closest&&event.target.closest(MENU_LINK);
    if(!link||!onHomepage())return;
    // Prevent the browser following a hash before React has mounted the
    // target. The existing menu handler still receives the click and closes.
    event.preventDefault();
    if(window.location.hash!==TARGET_HASH){
      window.history.pushState(window.history.state,"",TARGET_HASH);
    }
    focusAreas();
  },true);
  window.addEventListener("nbg:areas-mounted",function(){
    if(onHomepage()&&window.location.hash===TARGET_HASH)focusAreas();
  });
  function onLoad(){
    // A newly opened deep link to the generated area section must work too.
    // A normal refresh clears old hashes in index.html's reload handler.
    if(onHomepage()&&window.location.hash===TARGET_HASH)focusAreas();
  }
  if(document.readyState==="loading")
    document.addEventListener("DOMContentLoaded",onLoad,{once:true});
  else onLoad();
})();
