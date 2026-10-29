/*
 * N64 preview only: each checkerboard flag controls its own left-to-right
 * washer animation. Start when the FLAG (not its much taller parent section)
 * actually enters view, pause if a mobile visitor scrolls past too quickly,
 * then show LEVEL COMPLETED! and award the one-time level XP.
 */
(function () {
  "use strict";

  const selector = ".n64-level-track";
  const registered = new WeakSet();
  const fallbackTimers = new WeakMap();
  const reducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  function clearFallback(track) {
    const timer = fallbackTimers.get(track);
    if (timer) window.clearTimeout(timer);
    fallbackTimers.delete(track);
  }

  function finish(track) {
    if (track.dataset.n64RunStage === "complete") return;
    clearFallback(track);
    track.dataset.n64RunStage = "complete";
    track.classList.remove("n64-run-active");
    track.classList.add("n64-run-complete");
    track.querySelector(".n64-level-washer")?.style.removeProperty("animation-play-state");
    visibilityObserver?.unobserve(track);

    const sectionId = track.closest("section")?.id;
    window.n64Score?.awardLevel(sectionId);
  }

  function scheduleFallback(track) {
    clearFallback(track);
    const timer = window.setTimeout(() => {
      if (
        track.isConnected &&
        track.dataset.n64RunStage === "running" &&
        track.dataset.n64Visible === "true"
      ) finish(track);
    }, 8000);
    fallbackTimers.set(track, timer);
  }

  function start(track) {
    if (track.dataset.n64RunStage !== "ready") return;
    if (reducedMotion?.matches) {
      finish(track);
      return;
    }
    track.dataset.n64RunStage = "running";
    track.classList.add("n64-run-active");
    track.querySelector(".n64-level-washer")?.style.setProperty("animation-play-state", "running", "important");
    scheduleFallback(track);
  }

  function setVisible(track, visible) {
    if (track.dataset.n64RunStage === "complete") return;
    track.dataset.n64Visible = String(visible);
    if (visible && track.dataset.n64RunStage === "ready") {
      start(track);
    } else if (track.dataset.n64RunStage === "running") {
      const sprite = track.querySelector(".n64-level-washer");
      if (visible) {
        sprite?.style.setProperty("animation-play-state", "running", "important");
        scheduleFallback(track);
      } else {
        sprite?.style.setProperty("animation-play-state", "paused", "important");
        clearFallback(track);
      }
    }
  }

  const visibilityObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            // Require a meaningful portion of the checkerboard itself onscreen.
            setVisible(entry.target, entry.isIntersecting && entry.intersectionRatio >= 0.4);
          }
        },
        { threshold: [0, 0.4, 0.6], rootMargin: "0px" }
      )
    : null;

  // Compatibility fallback for older embedded mobile browsers.
  const fallbackTracks = new Set();
  function checkVisibilityWithoutObserver() {
    if (visibilityObserver) return;
    for (const track of fallbackTracks) {
      if (!track.isConnected || track.dataset.n64RunStage === "complete") {
        fallbackTracks.delete(track);
        continue;
      }
      const rect = track.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      setVisible(track, rect.height > 0 && visibleHeight / rect.height >= 0.4);
    }
  }

  function register(track) {
    if (registered.has(track)) return;
    if (!track.closest("#main-content.n64-world, #areas-we-cover, #customer-portal, #level-08-final")) return;
    registered.add(track);
    track.dataset.n64RunStage = "ready";
    track.dataset.n64Visible = "false";

    const sprite = track.querySelector(".n64-level-washer");
    if (sprite) {
      sprite.addEventListener("animationend", (event) => {
        if (event.target === sprite && event.animationName === "n64-washer-travel") {
          finish(track);
        }
      });
    }

    if (visibilityObserver) {
      visibilityObserver.observe(track);
    } else {
      fallbackTracks.add(track);
      checkVisibilityWithoutObserver();
    }
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
    }).observe(document.body, { childList: true, subtree: true });

    if (!visibilityObserver) {
      window.addEventListener("scroll", checkVisibilityWithoutObserver, { passive: true });
      window.addEventListener("resize", checkVisibilityWithoutObserver, { passive: true });
      checkVisibilityWithoutObserver();
    }

    reducedMotion?.addEventListener?.("change", (event) => {
      if (!event.matches) return;
      document.querySelectorAll(".n64-level-track.n64-run-active").forEach(finish);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }
})();
