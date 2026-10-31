/*
 * NI Bin Guy N64 preview: ONE run per level, then persistent LEVEL COMPLETED.
 * Level 06 (Areas We Cover) is injected by an independent legacy script; on
 * some devices its older cached version omits the mascot track entirely.
 * This controller repairs that ONE missing track before registering levels.
 * Reaching a completed checkpoint again never replays or awards extra XP.
 */
(function () {
  "use strict";

  const TRACK = ".n64-level-track";
  const registered = new WeakSet();
  const waiting = new Set();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let checkScheduled = false;

  function ensureAreasTrack() {
    const area = document.getElementById("areas-we-cover");
    if (!area || area.querySelector(TRACK)) return;

    // The area section is not rendered by React. Give it exactly the same
    // track / pixel mascot / completion label as Levels 01-05 and 07-08.
    const track = document.createElement("div");
    track.className = "n64-level-track";
    track.setAttribute("aria-hidden", "true");

    const picture = document.createElement("picture");
    picture.className = "n64-level-washer";
    const still = document.createElement("source");
    still.media = "(prefers-reduced-motion: reduce)";
    still.srcset = "/n64-pixel-bin-washer-still.svg";
    still.type = "image/svg+xml";
    const image = document.createElement("img");
    image.src = "/n64-pixel-bin-washer.svg";
    image.alt = "";
    image.width = 244;
    image.height = 149;
    image.loading = "eager";
    image.decoding = "async";
    picture.append(still, image);

    const message = document.createElement("span");
    message.className = "n64-level-complete";
    message.textContent = "LEVEL COMPLETED!";

    track.append(picture, message);
    area.appendChild(track);
  }

  function finish(track) {
    if (!track.isConnected || track.dataset.n64RunStage === "complete") return;
    window.clearTimeout(track._n64Timer);
    track._n64Timer = null;
    track.dataset.n64RunStage = "complete";
    track.classList.remove("n64-run-active");
    track.classList.add("n64-run-complete");
    waiting.delete(track);

    const levelId = track.closest("section")?.id;
    window.n64Score?.awardLevel(levelId);
  }

  function runOnce(track) {
    if (!track.isConnected || track.dataset.n64RunStage !== "ready") return;
    track.dataset.n64RunStage = "running";
    waiting.delete(track);

    if (reducedMotion?.matches) {
      finish(track);
      return;
    }

    // Reflow starts the sprite at the left edge even in Android webviews.
    track.classList.remove("n64-run-active");
    void track.offsetWidth;
    track.classList.add("n64-run-active");

    const sprite = track.querySelector(".n64-level-washer");
    sprite?.addEventListener("animationend", function onEnd(event) {
      if (event.target === sprite && event.animationName === "n64-washer-travel") {
        sprite.removeEventListener("animationend", onEnd);
        finish(track);
      }
    });
    // Safari, embedded browsers and offscreen tabs sometimes suppress this
    // event. End after the same duration rather than leaving a blank flag.
    const duration = window.innerWidth >= 800 ? 5200 : 3200;
    track._n64Timer = window.setTimeout(() => finish(track), duration + 450);
  }

  function checkVisible() {
    checkScheduled = false;
    const h = window.innerHeight || document.documentElement.clientHeight;
    const safeTop = Math.min(150, h * 0.2);
    const enterLine = Math.max(safeTop + 5, h * 0.68);

    for (const track of waiting) {
      if (!track.isConnected) {
        waiting.delete(track);
        continue;
      }
      if (track.dataset.n64RunStage !== "ready") {
        waiting.delete(track);
        continue;
      }
      const rect = track.getBoundingClientRect();
      // Wait until the strip is actually visible rather than starting the
      // animation when the level container first enters the viewport.
      if (rect.height > 0 && rect.top < enterLine && rect.bottom > safeTop) {
        runOnce(track);
      }
    }
  }

  function scheduleCheck() {
    if (checkScheduled) return;
    checkScheduled = true;
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(checkVisible);
    } else {
      window.setTimeout(checkVisible, 16);
    }
  }

  function register(track) {
    if (registered.has(track)) return;
    if (!track.closest("#main-content.n64-world, #areas-we-cover, #customer-portal, #level-08-final")) return;
    registered.add(track);
    track.dataset.n64RunStage = "ready";
    waiting.add(track);
    scheduleCheck();
  }

  function scan(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 9)) return;
    if (node.matches?.("#areas-we-cover") || node.querySelector?.("#areas-we-cover")) {
      ensureAreasTrack();
    }
    if (node.matches?.(TRACK)) register(node);
    node.querySelectorAll?.(TRACK).forEach(register);
  }

  function init() {
    ensureAreasTrack();
    scan(document);

    new MutationObserver((records) => {
      // Covers React-created levels and the independent Level 06 section.
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
