/*
 * N64 preview — each four-row level flag plays once when it enters view.
 * The animation is never left paused after a fast mobile scroll. Completion
 * is recorded even if animationend does not fire in an embedded browser.
 */
(function () {
  "use strict";
  const selector = ".n64-level-track";
  const targets = new Set();
  const seen = new WeakSet();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let checkQueued = false;

  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) play(entry.target);
        }
      }, { threshold: 0, rootMargin: "0px" })
    : null;

  function finish(track) {
    if (track.dataset.n64RunStage === "complete") return;
    if (track._n64FinishTimer) window.clearTimeout(track._n64FinishTimer);
    track._n64FinishTimer = null;
    track.dataset.n64RunStage = "complete";
    track.classList.remove("n64-run-active");
    track.classList.add("n64-run-complete");
    observer?.unobserve(track);
    targets.delete(track);
    const levelId = track.closest("section")?.id;
    window.n64Score?.awardLevel(levelId);
  }

  function play(track) {
    if (!track?.isConnected || track.dataset.n64RunStage !== "ready") return;
    if (reducedMotion?.matches) {
      finish(track);
      return;
    }
    track.dataset.n64RunStage = "running";
    // Force a fresh animation even after a restored bfcache/mobile viewport.
    track.classList.remove("n64-run-active");
    void track.offsetWidth;
    track.classList.add("n64-run-active");
    observer?.unobserve(track);
    const duration = window.innerWidth >= 800 ? 5200 : 3200;
    // Always complete, even when the browser never sends animationend.
    track._n64FinishTimer = window.setTimeout(() => finish(track), duration + 550);
  }

  function checkViewport() {
    checkQueued = false;
    const height = window.innerHeight || document.documentElement.clientHeight;
    for (const track of targets) {
      if (!track.isConnected) {
        targets.delete(track);
        continue;
      }
      if (track.dataset.n64RunStage !== "ready") continue;
      const rect = track.getBoundingClientRect();
      if (rect.height > 0 && rect.top < height && rect.bottom > 0) play(track);
    }
  }

  function scheduleCheck() {
    if (checkQueued) return;
    checkQueued = true;
    window.requestAnimationFrame?.(checkViewport)
      || window.setTimeout(checkViewport, 0);
  }

  function register(track) {
    if (seen.has(track)) return;
    if (!track.closest("#main-content.n64-world, #areas-we-cover, #customer-portal, #level-08-final")) return;
    seen.add(track);
    targets.add(track);
    track.dataset.n64RunStage = "ready";
    const sprite = track.querySelector(".n64-level-washer");
    sprite?.addEventListener("animationend", (event) => {
      if (event.target === sprite && event.animationName === "n64-washer-travel") finish(track);
    });
    observer?.observe(track);
    scheduleCheck();
  }

  function scan(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 9)) return;
    if (node.matches?.(selector)) register(node);
    node.querySelectorAll?.(selector).forEach(register);
  }

  function init() {
    scan(document);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) scan(node);
      }
      scheduleCheck();
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", scheduleCheck, { passive: true });
    window.addEventListener("resize", scheduleCheck, { passive: true });
    window.addEventListener("pageshow", scheduleCheck);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleCheck();
    });
    reducedMotion?.addEventListener?.("change", (event) => {
      if (event.matches) {
        document.querySelectorAll(".n64-level-track.n64-run-active").forEach(finish);
      }
    });
    scheduleCheck();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
