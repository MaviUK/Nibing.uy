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
