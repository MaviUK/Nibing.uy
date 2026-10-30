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
  let bookingProof = null;
  let playerToken = readPlayerCookie();
  let progressTimer = null;
  let progressSyncing = false;
  let progressSyncAgain = false;
  let boardNode, consentNode, entryStatus, boardNote;

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
    return award(key, Math.min(total, 30000), "Booking sent: " + binCount + " bin" + (binCount === 1 ? "" : "s"));
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

  function offerEntry(proof) {
    if (typeof proof !== "string" || !proof.includes(".")) return;
    bookingProof = proof;
    if (!root || !consentNode) return;
    consentNode.hidden = false;
    root.querySelector(".n64-score-panel").hidden = false;
    root.querySelector(".n64-score-toggle").setAttribute("aria-expanded", "true");
    entryStatus.textContent = "Booking received! Join the scoreboard if you want to enter the prize draw.";
  }

  async function joinLeaderboard(button) {
    if (!bookingProof) return;
    button.disabled = true;
    entryStatus.textContent = "Registering your score…";
    try {
      const response = await fetch("/.netlify/functions/arcadeLeaderboard",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({bookingProof,consent:true,claimed:[...claimed]})
      });
      const result = await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(result.error || "Unable to join");
      entryStatus.textContent = "You're on the leaderboard! Contact details stay private.";
      if (result.playerToken) {
        playerToken = result.playerToken;
        writePlayerCookie();
        // Booking + opt-in implies saving game points for future visits.
        saved = true;
        writeCookie();
        paint();
      }
      bookingProof = null;
      consentNode.hidden = true;
      await refreshLeaderboard();
      window.dispatchEvent(new Event("n64:leaderboard-updated"));
    } catch(error) {
      entryStatus.textContent = error.message || "Unable to join right now";
      button.disabled = false;
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
      scoreStyle.href = "/n64-scoreboard.css?v=3";
      scoreStyle.dataset.n64ScoreStyle = "true";
      document.head.appendChild(scoreStyle);
    }

    root = document.createElement("aside");
    root.className = "n64-score-hud";
    root.setAttribute("aria-label", "NI Bin Guy arcade score");
    root.innerHTML = [
      '<button type="button" class="n64-score-toggle" aria-expanded="false" aria-controls="n64-score-details">',
      '<span aria-hidden="true">★</span> <strong data-n64-score>0</strong><small>XP</small></button>',
      '<div class="n64-score-panel" id="n64-score-details" hidden>',
      '<div class="n64-score-heading"><strong>★ PLAYER SCORE</strong><button type="button" class="n64-score-close" aria-label="Close scoreboard">×</button></div>',
      '<div class="n64-score-earned" aria-live="polite"></div>',
      '<section class="n64-board"><strong>🏆 GLOBAL LEADERBOARD</strong><ol class="n64-board-list"><li>Loading scores…</li></ol><p class="n64-board-note"></p></section>',
      '<div class="n64-leader-consent" hidden><label><input type="checkbox" class="n64-entry-optin"> I agree to display my name and XP publicly and be contacted using my private booking details if I win a prize.</label><button type="button" class="n64-join-board" disabled>Join leaderboard</button><p class="n64-entry-status" aria-live="polite"></p></div>',
      '<p class="n64-score-hint">Level +50 • Area +25 • Bin day +35</p>',
      '<p class="n64-score-hint">One-off +60/bin • 4-weekly +150/bin</p>',
      '<ol class="n64-score-history"></ol>',
      '<p class="n64-score-persistence"></p>',
      '<div class="n64-score-controls"><button type="button" class="n64-score-save">Save XP (cookie)</button><button type="button" class="n64-score-reset">Reset score</button></div>',
      '<p class="n64-score-legal">XP and completed levels can be saved in a cookie. After you opt in to the global leaderboard, a separate anonymous-ID cookie keeps your score in sync. Prize contacts stay private.</p>',
      '</div>',
    ].join("");

    const toggle = root.querySelector(".n64-score-toggle");
    const panel = root.querySelector(".n64-score-panel");
    scoreNode = root.querySelector("[data-n64-score]");
    boardNode = root.querySelector(".n64-board-list");
    boardNote = root.querySelector(".n64-board-note");
    consentNode = root.querySelector(".n64-leader-consent");
    entryStatus = root.querySelector(".n64-entry-status");
    recentNode = root.querySelector(".n64-score-earned");
    historyNode = root.querySelector(".n64-score-history");
    savedNode = root.querySelector(".n64-score-persistence");
    saveButton = root.querySelector(".n64-score-save");
    resetButton = root.querySelector(".n64-score-reset");

    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) void refreshLeaderboard();
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
      deletePlayerCookie();
      playerToken = null;
      if (progressTimer) window.clearTimeout(progressTimer);
      progressTimer = null;
      saved = false;
      xp = 0;
      claimed = new Set();
      history = [];
      paint();
    });
    document.body.appendChild(root);
    const consentCheck = root.querySelector(".n64-entry-optin");
    const join = root.querySelector(".n64-join-board");
    consentCheck.addEventListener("change", () => {join.disabled = !consentCheck.checked;});
    join.addEventListener("click", () => {if(consentCheck.checked) joinLeaderboard(join);});
    paint();
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
  }

  window.n64Score = Object.freeze({
    awardLevel,
    awardAction,
    awardBooking,
    offerEntry,
    points: () => xp,
    rules: POINTS,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildHud, { once: true });
  } else {
    buildHud();
  }
})();
