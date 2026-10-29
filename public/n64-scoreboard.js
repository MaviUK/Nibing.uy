/*
 * NI Bin Guy N64 preview - optional cookie-saved arcade XP.
 * Stores points and completed activity keys only. Never saves addresses,
 * names, postcodes, emails, phone numbers or payment information.
 * Local game points have no monetary or redemption value.
 */
(function () {
  "use strict";
  if (window.n64Score) return;

  const COOKIE_NAME = "nbg_arcade_score_v1";
  const COOKIE_MAX_AGE = 180 * 24 * 60 * 60;
  const POINTS = Object.freeze({
    level: 50,
    coverage: 25,
    binChecker: 35,
    oneOffPerBin: 60,
    fourWeeklyPerBin: 150,
  });
  const LEVELS = Object.freeze({
    "what-we-do": 1,
    "the-process": 2,
    "bins-we-clean": 3,
    "why-clean-your-bin": 4,
    "why-ni-bin-guy": 5,
    "areas-we-cover": 6,
    "customer-portal": 7,
    "level-08-final": 8,
  });
  const MAX_HISTORY = 8;
  const MAX_BOOKING_KEYS = 45;
  const permanentKeys = new Set(
    Object.keys(LEVELS).map((id) => "l:" + id).concat(["a:coverage", "a:bin-checker"])
  );

  function readCookie() {
    try {
      const entry = document.cookie
        .split("; ")
        .find((part) => part.startsWith(COOKIE_NAME + "="));
      if (!entry) return null;
      const value = JSON.parse(decodeURIComponent(entry.slice(COOKIE_NAME.length + 1)));
      if (!value || value.v !== 1 || !Number.isSafeInteger(value.xp) || value.xp < 0) return null;
      if (!Array.isArray(value.claimed)) return null;
      return {
        xp: Math.min(value.xp, 100000000),
        claimed: value.claimed.filter((key) => typeof key === "string" && /^[a-z0-9:._-]{1,80}$/i.test(key)).slice(-100),
        history: Array.isArray(value.history)
          ? value.history.filter((item) => Array.isArray(item) && typeof item[0] === "string"
              && Number.isSafeInteger(item[1])).slice(0, MAX_HISTORY)
          : [],
      };
    } catch (_) {
      return null;
    }
  }

  const stored = readCookie();
  let saved = Boolean(stored);
  let xp = stored ? stored.xp : 0;
  let claimed = new Set(stored ? stored.claimed : []);
  let history = stored ? stored.history : [];
  let root, scoreNode, recentNode, historyNode, savedNode, saveButton, resetButton;
  let refreshQueued = false;

  function deleteCookie() {
    try {
      document.cookie = COOKIE_NAME + "=; Path=/; Max-Age=0; SameSite=Lax"
        + (location.protocol === "https:" ? "; Secure" : "");
    } catch (_) {}
  }

  function writeCookie() {
    if (!saved) return;
    try {
      const keep = [...claimed].filter((key) => permanentKeys.has(key));
      const bookingKeys = [...claimed].filter((key) => key.startsWith("b:")).slice(-MAX_BOOKING_KEYS);
      const value = encodeURIComponent(JSON.stringify({
        v: 1,
        xp,
        claimed: keep.concat(bookingKeys),
        history: history.slice(0, MAX_HISTORY),
      }));
      document.cookie = COOKIE_NAME + "=" + value + "; Path=/; Max-Age=" + COOKIE_MAX_AGE
        + "; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    } catch (error) {
      console.warn("Could not save arcade score on this device:", error);
    }
  }

  function paint() {
    if (!root) return;
    scoreNode.textContent = xp.toLocaleString("en-GB");
    if (history.length) {
      recentNode.textContent = "+" + history[0][1] + " XP  " + history[0][0];
    } else {
      recentNode.textContent = "Complete a level to earn XP";
    }
    historyNode.replaceChildren();
    for (const [label, points] of history.slice(0, 5)) {
      const line = document.createElement("li");
      const title = document.createElement("span");
      title.textContent = label;
      const value = document.createElement("strong");
      value.textContent = "+" + points;
      line.appendChild(title);
      line.appendChild(value);
      historyNode.appendChild(line);
    }
    savedNode.textContent = saved
      ? "Score saved in a first-party cookie on this device."
      : "Score works during this visit. Choose Save XP to keep it on this device.";
    saveButton.hidden = saved;
    resetButton.hidden = !saved && !xp && !claimed.size;
  }

  function redraw() {
    if (!root || refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      paint();
    });
  }

  function award(key, points, label) {
    if (typeof key !== "string" || !/^[a-z0-9:._-]{1,80}$/i.test(key)) return false;
    if (!Number.isSafeInteger(points) || points <= 0 || points > 30000) return false;
    if (claimed.has(key)) return false;
    claimed.add(key);
    xp = Math.min(xp + points, 100000000);
    history = [[label, points], ...history].slice(0, MAX_HISTORY);
    writeCookie();
    redraw();
    return true;
  }

  function awardLevel(sectionId) {
    const level = LEVELS[String(sectionId || "")];
    return level ? award("l:" + sectionId, POINTS.level, "Level " + String(level).padStart(2, "0") + " completed") : false;
  }

  function awardAction(name) {
    if (name === "coverage") return award("a:coverage", POINTS.coverage, "Checked service area");
    if (name === "bin-checker") return award("a:bin-checker", POINTS.binChecker, "Checked bin collection day");
    return false;
  }

  function awardBooking(submissionId, bins) {
    if (typeof submissionId !== "string" || !/^[a-z0-9_-]{6,90}$/i.test(submissionId) || !Array.isArray(bins)) return false;
    let total = 0;
    let binCount = 0;
    for (const bin of bins.slice(0, 30)) {
      if (!bin || typeof bin.type !== "string" || !bin.type.trim()) continue;
      const count = Math.min(100, Math.max(0, Math.floor(Number(bin.count) || 0)));
      if (!count) continue;
      const plan = String(bin.planId || "");
      if (plan.endsWith("_oneoff")) total += count * POINTS.oneOffPerBin;
      else if (plan.endsWith("_4w")) total += count * POINTS.fourWeeklyPerBin;
      else continue;
      binCount += count;
    }
    if (!total || !binCount) return false;
    // Only a random submission reference is retained, never the customer's details.
    const key = "b:" + submissionId.slice(-24).toLowerCase();
    return award(key, Math.min(total, 30000), "Booking sent: " + binCount + " bin" + (binCount === 1 ? "" : "s"));
  }

  function buildHud() {
    if (root || !document.body) return;
    root = document.createElement("aside");
    root.className = "n64-score-hud";
    root.setAttribute("aria-label", "NI Bin Guy arcade score");
    root.innerHTML = [
      '<button type="button" class="n64-score-toggle" aria-expanded="false" aria-controls="n64-score-details">',
      '<span aria-hidden="true">★</span> <strong data-n64-score>0</strong><small>XP</small></button>',
      '<div class="n64-score-panel" id="n64-score-details" hidden>',
      '<div class="n64-score-heading"><strong>★ PLAYER SCORE</strong><button type="button" class="n64-score-close" aria-label="Close scoreboard">×</button></div>',
      '<div class="n64-score-earned" aria-live="polite"></div>',
      '<p class="n64-score-hint">Level +50 • Area +25 • Bin day +35</p>',
      '<p class="n64-score-hint">One-off +60/bin • 4-weekly +150/bin</p>',
      '<ol class="n64-score-history"></ol>',
      '<p class="n64-score-persistence"></p>',
      '<div class="n64-score-controls"><button type="button" class="n64-score-save">Save XP (cookie)</button><button type="button" class="n64-score-reset">Reset score</button></div>',
      '<p class="n64-score-legal">Just for fun — not a discount or monetary reward. No personal details stored.</p>',
      '</div>',
    ].join("");

    const toggle = root.querySelector(".n64-score-toggle");
    const panel = root.querySelector(".n64-score-panel");
    scoreNode = root.querySelector("[data-n64-score]");
    recentNode = root.querySelector(".n64-score-earned");
    historyNode = root.querySelector(".n64-score-history");
    savedNode = root.querySelector(".n64-score-persistence");
    saveButton = root.querySelector(".n64-score-save");
    resetButton = root.querySelector(".n64-score-reset");

    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    }

    toggle.addEventListener("click", () => setOpen(panel.hidden));
    root.querySelector(".n64-score-close").addEventListener("click", () => setOpen(false));
    saveButton.addEventListener("click", () => {
      saved = true;
      writeCookie();
      paint();
    });
    resetButton.addEventListener("click", () => {
      deleteCookie();
      saved = false;
      xp = 0;
      claimed = new Set();
      history = [];
      paint();
    });
    document.body.appendChild(root);
    paint();
  }

  window.n64Score = Object.freeze({
    awardLevel,
    awardAction,
    awardBooking,
    points: () => xp,
    rules: POINTS,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildHud, { once: true });
  } else {
    buildHud();
  }
})();
