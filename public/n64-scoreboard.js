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
  const PLAYER_COOKIE_NAME = "nbg_arcade_player_v1";
  const PLAYER_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
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

  // This cookie contains only a signed pseudonymous player reference.
  // It is created after an explicit, verified booking + prize opt-in.
  function readPlayerCookie() {
    const entry = document.cookie.split("; ")
      .find((part) => part.startsWith(PLAYER_COOKIE_NAME + "="));
    if (!entry) return null;
    const token = decodeURIComponent(entry.slice(PLAYER_COOKIE_NAME.length + 1));
    return token.length < 700 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
  }

  const stored = readCookie();
  let saved = Boolean(stored);
  let xp = stored ? stored.xp : 0;
  let claimed = new Set(stored ? stored.claimed : []);
  let history = stored ? stored.history : [];
  let root, scoreNode, recentNode, historyNode, savedNode, saveButton, resetButton;
  let refreshQueued = false;
  let playerToken = readPlayerCookie();
  let recoveryAttempted = false;
  let progressTimer = null;
  let progressSyncing = false;
  let progressSyncAgain = false;
  let boardNode, boardNote;

  function deleteCookie() {
    try {
      document.cookie = COOKIE_NAME + "=; Path=/; Max-Age=0; SameSite=Lax"
        + (location.protocol === "https:" ? "; Secure" : "");
    } catch (_) {}
  }

  function writePlayerCookie() {
    if (!playerToken) return;
    document.cookie = PLAYER_COOKIE_NAME + "=" + encodeURIComponent(playerToken)
      + "; Path=/; Max-Age=" + PLAYER_COOKIE_MAX_AGE + "; SameSite=Lax"
      + (location.protocol === "https:" ? "; Secure" : "");
  }

  function deletePlayerCookie() {
    document.cookie = PLAYER_COOKIE_NAME + "=; Path=/; Max-Age=0; SameSite=Lax"
      + (location.protocol === "https:" ? "; Secure" : "");
  }

  function writeCookie() {
    if (!saved) return;
    try {
      const keep = [...claimed].filter((key) => permanentKeys.has(key));
      const bookingKeys = [...claimed].filter((key) => key.startsWith("b:")).slice(-MAX_BOOKING_KEYS);
      const privateKeys = [...claimed].filter((key) => key.startsWith("o:")).slice(-MAX_BOOKING_KEYS);
      const value = encodeURIComponent(JSON.stringify({
        v: 1,
        xp,
        claimed: keep.concat(bookingKeys, privateKeys),
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
      ? "XP saved in a first-party cookie on this device."
      : "XP lasts this visit. Choose Save XP to remember it on this device.";
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
    window.dispatchEvent(new Event("n64:score-updated"));
    scheduleProgressSync();
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
    // Once a booking is confirmed, save the XP and random booking reference
    // automatically. It is needed to restore an entry after a brief outage.
    saved = true;
    const earned = award(key, Math.min(total, 30000), "Booking sent: " + binCount + " bin" + (binCount === 1 ? "" : "s"));
    writeCookie();
    redraw();
    return earned;
  }


  // Debounced: several points earned together trigger one server update.
  // The signed token never exposes name, email, address or phone.
  function scheduleProgressSync() {
    if (!playerToken) return;
    if (progressTimer) window.clearTimeout(progressTimer);
    progressTimer = window.setTimeout(() => {
      progressTimer = null;
      void syncProgress();
    }, 1200);
  }

  async function syncProgress() {
    if (!playerToken) return;
    if (progressSyncing) { progressSyncAgain = true; return; }
    progressSyncing = true;
    const token = playerToken;
    try {
      const response = await fetch("/.netlify/functions/arcadeLeaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", playerToken: token, claimed: [...claimed] }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        if (playerToken === token) {
          playerToken = null;
          deletePlayerCookie();
          if (boardNote) boardNote.textContent = "XP session expired. Your local XP remains saved.";
        }
        return;
      }
      if (!response.ok) throw new Error(data.error || "XP sync failed");
      if (data.changed) {
        window.dispatchEvent(new Event("n64:leaderboard-updated"));
      }
    } catch (_) {
      // Offline browsers retain the XP cookie; resync on next connection.
      if (boardNote) boardNote.textContent = "Offline: local XP saved; global XP will sync when connected.";
    } finally {
      progressSyncing = false;
      if (progressSyncAgain) {
        progressSyncAgain = false;
        scheduleProgressSync();
      }
    }
  }

  async function refreshLeaderboard() {
    if (!boardNode) return;
    try {
      const response = await fetch("/.netlify/functions/arcadeLeaderboard", {cache:"no-store"});
      if (!response.ok) throw new Error("Leaderboard unavailable");
      const data = await response.json();
      const top = Array.isArray(data.entries) ? data.entries.slice(0,10) : [];
      boardNode.replaceChildren();
      if (!top.length) {
        const li = document.createElement("li");
        li.textContent = "No players yet — be the first!";
        boardNode.appendChild(li);
      }
      top.forEach((item) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = item.rank + ". " + item.name;
        const score = document.createElement("strong");
        score.textContent = Number(item.points || 0).toLocaleString("en-GB") + " XP";
        li.append(name,score);
        boardNode.appendChild(li);
      });
      boardNote.textContent = "Public: display name and XP only.";
    } catch (_) { boardNote.textContent = "Leaderboard currently unavailable. Your XP remains on this device."; }
  }

  function bookingKey(id) {
    if (typeof id !== "string" || !/^[a-z0-9_-]{6,90}$/i.test(id)) return "";
    return id.slice(-24).toLowerCase();
  }

  function keepBookingPrivate(id) {
    const key = bookingKey(id);
    if (!key) return;
    claimed.add("o:" + key);
    // Preserve their opt-out alongside the booking points so a later page
    // visit cannot mistakenly recover this booking onto the public board.
    saved = true;
    writeCookie();
  }

  function attachPlayerToken(token) {
    if (typeof token !== "string" || token.length > 700 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
    playerToken = token;
    writePlayerCookie();
    saved = true;
    writeCookie();
    redraw();
    window.dispatchEvent(new Event("n64:score-updated"));
    window.dispatchEvent(new Event("n64:leaderboard-updated"));
    scheduleProgressSync();
    return true;
  }

  // No "Join" button. The server inserts the entry when the booking succeeds.
  // A client-side retry is automatic if the server was briefly unavailable.
  async function registerEntry(proof) {
    if (typeof proof !== "string" || !proof.includes(".")) {
      throw new Error("This booking could not be linked to its XP.");
    }
    const response = await fetch("/.netlify/functions/arcadeLeaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingProof: proof, consent: true, claimed: [...claimed] }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !attachPlayerToken(data.playerToken)) {
      throw new Error(data.error || "The leaderboard is temporarily unavailable.");
    }
    return data;
  }

  function onBookingConfirmed(result, optOut, submissionId) {
    if (optOut === true) {
      keepBookingPrivate(submissionId);
      return;
    }
    if (result?.arcadePlayerToken && attachPlayerToken(result.arcadePlayerToken)) return;
    if (typeof result?.arcadeBookingProof === "string") {
      void registerEntry(result.arcadeBookingProof).catch(() => {
        // Booking points stay on the phone. Future page loads also attempt
        // recovery using the random booking reference saved in its XP cookie.
      });
    }
  }

  // Backward compatibility with older preview screens, without displaying
  // their obsolete "Join Leaderboard" opt-in panel.
  function offerEntry(proof) {
    onBookingConfirmed({ arcadeBookingProof: proof }, false, "");
  }

  // Existing preview bookings have a random booking reference in the XP
  // cookie. Resolve it against a previously confirmed booking on the server,
  // then enrol this same visitor automatically without another booking.
  async function recoverExistingBookings() {
    if (playerToken || recoveryAttempted) return;
    recoveryAttempted = true;
    const previous = [...claimed]
      .filter((key) => key.startsWith("b:") && !claimed.has("o:" + key.slice(2)))
      .slice(-3).reverse();
    for (const key of previous) {
      if (playerToken) break;
      try {
        const response = await fetch("/.netlify/functions/arcadeRecoverBooking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookingId: key.slice(2), claimed: [...claimed],
          }),
        });
        if (!response.ok) continue;
        const result = await response.json();
        if (attachPlayerToken(result.playerToken)) break;
      } catch (_) {
        // Do not block the page or erase the existing local XP.
      }
    }
  }


  function buildHud() {
    if (root || !document.body) return;
    // Do not overlay the administrative, account or callback screens.
    if (!["/", "/street-booking"].includes(location.pathname.replace(/\/$/, "") || "/")) return;
    // This stylesheet is noncritical: loading it after the DOM is ready keeps
    // the homepage renderable even if a mobile browser delays this asset.
    if (!document.querySelector('link[data-n64-score-style]')) {
      const scoreStyle = document.createElement("link");
      scoreStyle.rel = "stylesheet";
      scoreStyle.href = "/n64-scoreboard.css?v=4";
      scoreStyle.dataset.n64ScoreStyle = "true";
      document.head.appendChild(scoreStyle);
    }

    root = document.createElement("aside");
    root.className = "n64-score-hud";
    root.setAttribute("aria-label", "NI Bin Guy arcade score");
    root.innerHTML = [
      '<button type="button" class="n64-score-backdrop" aria-label="Close score panel" hidden></button>',
      '<button type="button" class="n64-score-toggle" aria-expanded="false" aria-controls="n64-score-details">',
      '<span aria-hidden="true">★</span> <strong data-n64-score>0</strong><small>XP</small></button>',
      '<div class="n64-score-panel" id="n64-score-details" role="dialog" aria-modal="true" aria-labelledby="n64-score-heading-label" hidden>',
      '<div class="n64-score-heading"><strong id="n64-score-heading-label">★ PLAYER SCORE</strong><button type="button" class="n64-score-close" aria-label="Close scoreboard">×</button></div>',
      '<div class="n64-score-earned" aria-live="polite"></div>',
      '<section class="n64-board"><strong>🏆 GLOBAL LEADERBOARD</strong><ol class="n64-board-list"><li>Loading scores…</li></ol><p class="n64-board-note"></p></section>',
      '<p class="n64-score-hint">Level +50 • Area +25 • Bin day +35</p>',
      '<p class="n64-score-hint">One-off +60/bin • 4-weekly +150/bin</p>',
      '<ol class="n64-score-history"></ol>',
      '<p class="n64-score-persistence"></p>',
      '<div class="n64-score-controls"><button type="button" class="n64-score-save">Save XP (cookie)</button><button type="button" class="n64-score-reset">Reset score</button></div>',
      '<p class="n64-score-legal">After a confirmed booking, your name and XP go on the global board unless you opted out while booking. XP is saved with a first-party cookie. Private prize contacts stay private.</p>',
      '</div>',
    ].join("");

    const toggle = root.querySelector(".n64-score-toggle");
    const panel = root.querySelector(".n64-score-panel");
    const backdrop = root.querySelector(".n64-score-backdrop");
    const closeButton = root.querySelector(".n64-score-close");
    scoreNode = root.querySelector("[data-n64-score]");
    boardNode = root.querySelector(".n64-board-list");
    boardNote = root.querySelector(".n64-board-note");
    recentNode = root.querySelector(".n64-score-earned");
    historyNode = root.querySelector(".n64-score-history");
    savedNode = root.querySelector(".n64-score-persistence");
    saveButton = root.querySelector(".n64-score-save");
    resetButton = root.querySelector(".n64-score-reset");

    function setOpen(open) {
      panel.hidden = !open;
      backdrop.hidden = !open;
      root.classList.toggle("n64-score-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      if (open) {
        panel.scrollTop = 0;
        // The close control remains sticky even when the score list scrolls.
        closeButton.focus({ preventScroll: true });
        void refreshLeaderboard();
      } else {
        toggle.focus({ preventScroll: true });
      }
    }

    toggle.addEventListener("click", () => setOpen(panel.hidden));
    closeButton.addEventListener("click", () => setOpen(false));
    backdrop.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        setOpen(false);
      }
    });
    saveButton.addEventListener("click", () => {
      saved = true;
      writeCookie();
      paint();
    });
    resetButton.addEventListener("click", () => {
      deleteCookie();
      deletePlayerCookie();
      playerToken = null;
      if (progressTimer) window.clearTimeout(progressTimer);
      progressTimer = null;
      saved = false;
      xp = 0;
      claimed = new Set();
      history = [];
      paint();
      window.dispatchEvent(new Event("n64:score-updated"));
    });
    document.body.appendChild(root);
    paint();
    window.dispatchEvent(new Event("n64:score-updated"));
    refreshLeaderboard();
    window.addEventListener("online", scheduleProgressSync);
    window.addEventListener("pageshow", scheduleProgressSync);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleProgressSync();
    });
    window.setInterval(() => {
      if (!panel.hidden && document.visibilityState === "visible") void refreshLeaderboard();
    }, 15000);
    if (playerToken) scheduleProgressSync();
    else window.setTimeout(recoverExistingBookings, 1100);
  }

  window.n64Score = Object.freeze({
    awardLevel,
    awardAction,
    awardBooking,
    offerEntry,
    registerEntry,
    attachPlayerToken,
    onBookingConfirmed,
    keepBookingPrivate,
    activityKeys: () => [...claimed].filter(key => permanentKeys.has(key)),
    points: () => xp,
    isRegistered: () => Boolean(playerToken),
    rules: POINTS,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildHud, { once: true });
  } else {
    buildHud();
  }
})();
