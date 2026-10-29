/*
 * N64 preview level animation: the checkerboard is a replayable checkpoint.
 * On each visit the pixel washer runs left-to-right, then shows COMPLETED.
 * Departing and returning replays the artwork, but XP is awarded only once
 * per level by the cookie scoreboard. Visitors can also tap REPLAY.
 */
(function () {
  "use strict";
  const selector = ".n64-level-track";
  const tracks = new Set();
  const registered = new WeakSet();
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let pending = false;

  function clearFinish(track) {
    if (track._n64FinishTimer) window.clearTimeout(track._n64FinishTimer);
    track._n64FinishTimer = null;
  }

  function reset(track) {
    clearFinish(track);
    track.classList.remove("n64-run-active", "n64-run-complete");
    track.dataset.n64RunStage = "ready";
    delete track.dataset.n64ManualPlay;
    // Force CSS to restart from the beginning on a new visit.
    void track.offsetWidth;
  }

  function finish(track) {
    if (!track.isConnected || track.dataset.n64RunStage !== "running") return;
    clearFinish(track);
    track.dataset.n64RunStage = "complete";
    track.classList.remove("n64-run-active");
    track.classList.add("n64-run-complete");
    const level = track.closest("section")?.id;
    window.n64Score?.awardLevel(level);
  }

  function run(track, explicitReplay) {
    if (!track.isConnected || track.dataset.n64RunStage === "running") return;
    if (track.dataset.n64RunStage !== "ready") reset(track);
    const manual = explicitReplay === true;
    if (prefersReducedMotion?.matches && !manual) {
      // Honour reduced-motion settings; the replay control lets a visitor
      // deliberately opt into watching this one animation.
      track.dataset.n64RunStage = "running";
      finish(track);
      return;
    }
    track.dataset.n64ManualPlay = manual ? "true" : "false";
    track.dataset.n64RunStage = "running";
    track.classList.remove("n64-run-complete", "n64-run-active");
    void track.offsetWidth;
    track.classList.add("n64-run-active");
    // A timer guards browsers that never deliver CSS animationend.
    const duration = window.innerWidth >= 800 ? 5200 : 3200;
    clearFinish(track);
    track._n64FinishTimer = window.setTimeout(() => finish(track), duration + 350);
  }

  function viewportCheck() {
    pending = false;
    const height = window.innerHeight || document.documentElement.clientHeight;
    // Fixed page controls occupy the top of the viewport. Do not trigger the
    // sprite while only a couple of pixels are visible behind those controls.
    const safeTop = Math.min(95, height * 0.16);
    const safeBottom = height - Math.min(75, height * 0.13);

    for (const track of tracks) {
      if (!track.isConnected) { tracks.delete(track); continue; }
      const rect = track.getBoundingClientRect();
      const onScreen = rect.bottom > 0 && rect.top < height;
      const state = track.dataset.n64RunStage;

      if (!onScreen) {
        // A completed checkpoint must be replayable on the next visit.
        // Also cancel a run if someone scrolls completely past the flag.
        if (state === "complete" || state === "running") reset(track);
        continue;
      }

      if (state !== "ready" || rect.height <= 0) continue;
      const safeVisible = Math.max(0, Math.min(rect.bottom, safeBottom) - Math.max(rect.top, safeTop));
      if (safeVisible / rect.height >= 0.75) run(track, false);
    }
  }

  function scheduleCheck() {
    if (pending) return;
    pending = true;
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(viewportCheck);
    } else {
      window.setTimeout(viewportCheck, 16);
    }
  }

  function register(track) {
    if (registered.has(track)) return;
    if (!track.closest("#main-content.n64-world, #areas-we-cover, #customer-portal, #level-08-final")) return;
    registered.add(track);
    tracks.add(track);
    track.dataset.n64RunStage = "ready";

    // The original artwork and message are decorative; the replay control
    // needs to remain keyboard and screen-reader accessible.
    track.removeAttribute("aria-hidden");
    track.querySelector(".n64-level-washer")?.setAttribute("aria-hidden", "true");
    track.querySelector(".n64-level-complete")?.setAttribute("aria-hidden", "true");

    const sprite = track.querySelector(".n64-level-washer");
    sprite?.addEventListener("animationend", (event) => {
      if (event.target === sprite && event.animationName === "n64-washer-travel") {
        finish(track);
      }
    });

    const replay = document.createElement("button");
    replay.type = "button";
    replay.className = "n64-level-replay";
    replay.textContent = "\u21bb REPLAY";
    const name = track.closest("section")?.querySelector(".n64-final-kicker, .n64-portal-eyebrow")?.textContent?.trim()
      || track.closest("section")?.id?.replace(/-/g, " ") || "level";
    replay.setAttribute("aria-label", "Replay " + name + " animation");
    replay.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      run(track, true);
    });
    track.appendChild(replay);
    scheduleCheck();
  }

  function scan(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 9)) return;
    if (node.matches?.(selector)) register(node);
    node.querySelectorAll?.(selector).forEach(register);
  }

  function initialise() {
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
    prefersReducedMotion?.addEventListener?.("change", () => scheduleCheck());
    scheduleCheck();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }
})();
