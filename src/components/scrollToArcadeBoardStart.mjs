/**
 * Land at the very start of the N64 leaderboard area AFTER a tab switch.
 * The board swaps a tall public ranking for Customer HQ, which otherwise
 * causes Android Chrome to clamp the old scroll position partway down the
 * new panel. No hash/history mutations: real deep links still work.
 */
export function scrollToArcadeBoardStart(section, viewport=window, documentRef=document) {
  if(!section || typeof section.getBoundingClientRect!=="function" ||
     typeof viewport?.scrollTo!=="function") return false;
  const offset=section.getBoundingClientRect().top;
  const current=Number.isFinite(viewport.scrollY)?viewport.scrollY:
    (Number.isFinite(viewport.pageYOffset)?viewport.pageYOffset:0);
  if(!Number.isFinite(offset))return false;
  const target=Math.max(0,Math.round(current+offset));
  const rootStyle=documentRef?.documentElement?.style;
  const previousBehavior=rootStyle?.scrollBehavior;
  // The homepage has html{scroll-behavior:smooth}. We need to jump to the
  // correct position immediately, not animate towards a section that is
  // shrinking as React mounts the signed-in customer dashboard.
  if(rootStyle)rootStyle.scrollBehavior="auto";
  try {
    try {
      viewport.scrollTo({top:target,left:0,behavior:"instant"});
    } catch {
      // Older browsers that reject the options object use the numeric API.
      viewport.scrollTo(0,target);
    }
    return true;
  } finally {
    if(rootStyle)rootStyle.scrollBehavior=previousBehavior;
  }
}


/**
 * The screenshot's correct landing point is the TOP OF THE TABS, just under
 * the floating menu. Anchoring the entire section during a React.lazy swap
 * can be clamped while the HQ fallback is shorter than the mobile viewport.
 * Tabs are a stable DOM node and stay mounted through the swap.
 */
export function scrollToArcadeTabs(tabs,viewport=window,documentRef=document){
  if(!tabs || typeof tabs.getBoundingClientRect!=="function" ||
     typeof viewport?.scrollTo!=="function")return false;
  const rect=tabs.getBoundingClientRect();
  if(!Number.isFinite(rect?.top))return false;
  const current=Number.isFinite(viewport.scrollY)?viewport.scrollY:
    (Number.isFinite(viewport.pageYOffset)?viewport.pageYOffset:0);
  // 61px on mobile = the section's 9px top line plus 52px top padding;
  // the floating Check Your Area/menu controls finish just above the tabs.
  const mobile=!(Number.isFinite(viewport.innerWidth)&&viewport.innerWidth>600);
  const topOffset=mobile?61:79;
  const top=Math.max(0,Math.round(current+rect.top-topOffset));
  const style=documentRef?.documentElement?.style;
  const previous=style?.scrollBehavior;
  if(style)style.scrollBehavior="auto";
  try{
    try{viewport.scrollTo({left:0,top,behavior:"instant"});}
    catch{viewport.scrollTo(0,top);}
  }finally{
    if(style)style.scrollBehavior=previous;
  }
  return true;
}

/**
 * During React.lazy Customer HQ loading, the public leaderboard contracts,
 * then grows again when the authenticated account has loaded. Positioning
 * once immediately (the previous approach) can be clamped, leaving the
 * previous Book a Clean section visible. Re-align after each layout change,
 * but stop promptly when the customer touches or scrolls manually.
 */
export function stabilizeArcadeTabScroll(
  tabs,panel,viewport=window,documentRef=document
){
  if(!tabs)return ()=>{};
  let stopped=false;
  const timeouts=[],frames=[],cleanups=[];
  const style=documentRef?.documentElement?.style;
  const priorAnchor=style?.overflowAnchor;
  if(style)style.overflowAnchor="none";
  let resizeObserver=null,mutationObserver=null;
  const align=()=>{
    if(!stopped)scrollToArcadeTabs(tabs,viewport,documentRef);
  };
  const stop=()=>{
    if(stopped)return;
    stopped=true;
    if(resizeObserver)resizeObserver.disconnect();
    if(mutationObserver)mutationObserver.disconnect();
    for(const id of frames)viewport.cancelAnimationFrame?.(id);
    for(const id of timeouts)viewport.clearTimeout?.(id);
    for(const [name,fn] of cleanups)viewport.removeEventListener?.(name,fn);
    if(style)style.overflowAnchor=priorAnchor;
  };
  align();
  if(typeof viewport.requestAnimationFrame==="function"){
    const first=viewport.requestAnimationFrame(()=>{
      align();
      frames.push(viewport.requestAnimationFrame(align));
    });
    frames.push(first);
  }
  if(typeof viewport.setTimeout==="function"){
    // Fallback for browsers with no ResizeObserver and late async hydration.
    for(const ms of [90,260,700,1350])
      timeouts.push(viewport.setTimeout(align,ms));
    timeouts.push(viewport.setTimeout(stop,2000));
  }
  if(panel && typeof viewport.ResizeObserver==="function"){
    resizeObserver=new viewport.ResizeObserver(align);
    resizeObserver.observe(panel);
  }
  if(panel && typeof viewport.MutationObserver==="function"){
    mutationObserver=new viewport.MutationObserver(align);
    mutationObserver.observe(panel,{childList:true,subtree:true});
  }
  // Never drag the user back to the tabs after they begin interacting.
  for(const name of ["touchstart","wheel","pointerdown","keydown"]){
    if(typeof viewport.addEventListener==="function"){
      viewport.addEventListener(name,stop,{passive:true});
      cleanups.push([name,stop]);
    }
  }
  return stop;
}
