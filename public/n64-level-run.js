/*
 * N64 preview only: play a pixel-washer run when each checkerboard level
 * divider scrolls into view, then display LEVEL COMPLETED!
 * All effects are decorative and independent of booking or site navigation.
 */
(function () {
  "use strict";

  const selector = ".n64-level-track";
  const registered = new WeakSet();
  const reducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  const finish = (track) => {
    if (track.dataset.n64RunStage === "complete") return;
    track.dataset.n64RunStage = "complete";
    track.classList.remove("n64-run-active");
    track.classList.add("n64-run-complete");
    // One-time arcade reward for visiting and completing this level.
    const sectionId = track.closest("section")?.id;
    window.n64Score?.awardLevel(sectionId);
  };

  const start = (track) => {
    if (track.dataset.n64RunStage !== "ready") return;
    if (reducedMotion && reducedMotion.matches) {
      finish(track);
      return;
    }

    track.dataset.n64RunStage = "running";
    track.classList.add("n64-run-active");

    // Fallback if a browser fails to dispatch animationend after scrolling.
    window.setTimeout(() => finish(track), 7500);
  };

  const visibilityObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            visibilityObserver.unobserve(entry.target);
            start(entry.target._n64Flag || entry.target);
          }
        },
        { threshold: 0, rootMargin: "0px 0px 0px 0px" }
      )
    : null;

  function register(track) {
    if (registered.has(track)) return;
    if (!track.closest("#main-content.n64-world, #areas-we-cover, #customer-portal, #level-08-final")) return;

    registered.add(track);
    track.dataset.n64RunStage = "ready";

    const sprite = track.querySelector(".n64-level-washer");
    if (sprite) {
      sprite.addEventListener("animationend", (event) => {
        if (event.target === sprite && event.animationName === "n64-washer-travel") {
          finish(track);
        }
      });
    }

    if (visibilityObserver) {
      // Observe the level section, not just the narrow 64px strip.
      const target = track.closest("section") || track;
      target._n64Flag = track;
      visibilityObserver.observe(target);
    } else {
      start(track);
    }
  }

  function scan(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 9)) return;
    if (node.matches && node.matches(selector)) register(node);
    if (node.querySelectorAll) node.querySelectorAll(selector).forEach(register);
  }

  function initialise() {
    scan(document);

    // React mounts the five levels asynchronously; Areas We Cover is added
    // by privacy-link.js; the customer portal is a separate React section.
    // Only inspect inserted nodes, not every element on every mutation.
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) scan(node);
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    if (reducedMotion && reducedMotion.addEventListener) {
      reducedMotion.addEventListener("change", (event) => {
        if (event.matches) {
          document
            .querySelectorAll(".n64-level-track.n64-run-active")
            .forEach(finish);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }
})();
