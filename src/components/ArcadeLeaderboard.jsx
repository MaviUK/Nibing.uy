import React, { useEffect, useRef, useState } from "react";

const REFRESH_MS = 10000;
const ENDPOINT = "/.netlify/functions/arcadeLeaderboard";

export default function ArcadeLeaderboard() {
  const [players, setPlayers] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [connection, setConnection] = useState("connecting");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [sourceAsOf, setSourceAsOf] = useState(null);
  const [historyStatus, setHistoryStatus] = useState(null);
  const [nameConsentMode, setNameConsentMode] = useState(false);
  const [eligibilityPending, setEligibilityPending] = useState(false);
  const [eligiblePlayers, setEligiblePlayers] = useState(null);
  const [changes, setChanges] = useState({});
  const previousPlayers = useRef(null);
  const [localScore, setLocalScore] = useState({ points: 0, registered: false });


  useEffect(() => {
    let mounted = true;
    let busy = false;
    let refreshAgain = false;

    const refreshLocalScore = () => {
      if (!mounted) return;
      const api = window.n64Score;
      setLocalScore({
        points: Math.max(0, Number(api?.points?.() || 0)),
        registered: Boolean(api?.isRegistered?.()),
      });
    };
    refreshLocalScore();
    window.addEventListener("n64:score-updated", refreshLocalScore);

    async function refresh() {
      if (!mounted || document.visibilityState === "hidden") return;
      if (busy) { refreshAgain = true; return; }
      busy = true;
      try {
        const response = await fetch(ENDPOINT, { cache: "no-store" });
        if (!response.ok) throw new Error("Leaderboard temporarily unavailable");
        const data = await response.json();
        if (!mounted) return;
        const next = Array.isArray(data.entries)
          ? data.entries.slice(0, 10).map((p, i) => ({
              rank: i + 1,
              customerRef: String(p.customerRef || "NBG-UNKNOWN").slice(0, 20),
              displayName: typeof p.displayName === "string"
                ? p.displayName.slice(0, 40) : null,
              town: String(p.town || "Town unavailable").slice(0, 32),
              points: Number(p.points || 0),
            }))
          : [];

        if (previousPlayers.current !== null) {
          const before = previousPlayers.current;
          const movement = {};
          next.forEach((player) => {
            const old = before.find((p) => p.customerRef === player.customerRef);
            if (!old) movement[player.customerRef] = "new";
            else if (old.rank > player.rank) movement[player.customerRef] = "up";
            else if (old.rank < player.rank) movement[player.customerRef] = "down";
            else if (old.points !== player.points) movement[player.customerRef] = "points";
          });
          setChanges(movement);
        }
        previousPlayers.current = next;
        setPlayers(next);
        setTotalPlayers(Number.isFinite(Number(data.totalPlayers))
          ? Math.max(0, Number(data.totalPlayers)) : next.length);
        setUpdatedAt(new Date());
        setSourceAsOf(/^\d{4}-\d{2}-\d{2}$/.test(data.sourceAsOf || "") ? data.sourceAsOf : null);
        setHistoryStatus(data.status === "active_status_refresh_required" ? data.status : null);
        setNameConsentMode(data.status === "consent_only" || data.status === "consent_pending");
        setEligibilityPending(data.status === "eligibility_pending");
        setEligiblePlayers(Number.isInteger(data.eligiblePlayers) ? data.eligiblePlayers : null);
        setConnection("live");
      } catch (_) {
        if (mounted) setConnection("reconnecting");
      } finally {
        busy = false;
        if (refreshAgain) {
          refreshAgain = false;
          void refresh();
        }
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    window.addEventListener("n64:leaderboard-updated", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("n64:leaderboard-updated", refresh);
      window.removeEventListener("n64:score-updated", refreshLocalScore);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);


  return (
    <section id="live-leaderboard" className="n64-public-leaderboard" aria-labelledby="n64-board-title">
      <div className="n64-public-board-inner">
        <div className="n64-live-board-head">
          <span className="n64-board-eyebrow">★ HIGH SCORES ★</span>
          <span className={"n64-live-indicator" + (connection !== "live" ? " n64-live-indicator--offline" : "")}
            role="status" aria-live="polite">
            <span className="n64-live-indicator-dot" aria-hidden="true" />
            {connection === "live" ? (sourceAsOf ? "BACKUP SNAPSHOT" : "LIVE") : connection === "connecting" ? "CONNECTING" : "RECONNECTING"}
          </span>
        </div>
        <h2 id="n64-board-title">Global Leaderboard</h2>
        <p>{eligibilityPending
          ? "Preparing the verified Squeegee customer list. Only active accounts with a valid registered email can join the leaderboard; no names are public until permission is recorded."
          : nameConsentMode
          ? "Only active Squeegee customers with a registered email who have agreed to appear are shown by first name and town. Everyone else keeps their points privately."
          : sourceAsOf
          ? `Active Squeegee customer rankings from the ${new Date(sourceAsOf + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} backup. Loyalty points start at 20 per paid clean, rise by 2 for each consecutive completed visit, then restart at 20 after a recorded skipped visit. Verified linked website XP is added separately.`
          : "High scores update automatically. Only customer references, towns and XP are displayed."}</p>

        <div className="n64-your-score" aria-label="Your device score">
          <div><strong>★ YOUR SCORE</strong><span>{localScore.points.toLocaleString("en-GB")} XP</span></div>
          <small>{localScore.registered
            ? (sourceAsOf ? "Your website XP is saved. It joins the active-only board after your Squeegee account is verified." : "Your booking is registered. New level points sync to the global leaderboard.")
            : "Your XP stays on this device until a verified booking is linked. A registered email and your separate permission are required before you appear publicly."}</small>
        </div>


        <div className="n64-live-board-stats">
          <strong>{updatedAt ? totalPlayers.toLocaleString("en-GB") + (totalPlayers === 1 ? " PUBLIC PLAYER" : " PUBLIC PLAYERS") : "— PLAYERS"}</strong>
          <span>{connection === "live" && updatedAt
            ? (eligiblePlayers !== null ? eligiblePlayers.toLocaleString("en-GB") + " email-eligible · " : "") + "Updated " + updatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : "Checking scores…"}
          </span>
        </div>
        <p style={{textAlign:"center",margin:"12px 0"}}><a href="/customer-hq?ntl-drawer-state=hidden" style={{color:"#fce164",fontWeight:900}}>SIGN IN TO VIEW MY CLEANING POINTS →</a></p>
        <ol aria-label="Live top ten players">
          {!players.length ? (
            <li><span>{connection !== "live" ? "Waiting for live scores…" : eligibilityPending
              ? "Checking which customers have a registered email — no public scores yet."
              : nameConsentMode
              ? "Customer permissions are being collected — no public names yet."
              : "No registered players yet — be the first!"}</span></li>
          ) : players.map((player, i) => {
            const change = changes[player.customerRef];
            return (
              <li key={player.customerRef}
                className={change ? "n64-board-row n64-board-row--" + change : "n64-board-row"}>
                <a href="/customer-hq?ntl-drawer-state=hidden" title="Sign in to see your own points — this public entry does not grant account access" style={{color:"inherit",textDecoration:"none"}}><strong>{String(i + 1).padStart(2, "0")}</strong> {player.displayName || player.customerRef}<span className="n64-board-town"> · {player.town}</span></a>
                <span className="n64-board-score">
                  {change && <em className="n64-rank-change" aria-label={
                    change === "new" ? "New player" :
                    change === "up" ? "Rank up" :
                    change === "down" ? "Rank down" : "Score increased"
                  }>{change === "new" ? "NEW" : change === "up" ? "↑" : change === "down" ? "↓" : "+"}</em>}
                  <strong>{player.points.toLocaleString("en-GB")} XP</strong>
                </span>
              </li>
            );
          })}
        </ol>
        {connection === "reconnecting" && (
          <p className="n64-board-error" role="status">
            The leaderboard server is temporarily unavailable. Your device XP is unaffected; retrying automatically.
          </p>
        )}
        <small>
          {historyStatus ? "Active account-status verification is out of date; historical scores are temporarily hidden. " : ""}
          Tap any leaderboard name to open secure Customer HQ sign-in. You can only see the account verified by your own email code. The display refreshes every 10 seconds. Historical Squeegee scores only change after a verified data update.
          {nameConsentMode || eligibilityPending ? "Public entries require a registered email and recorded permission, and show first name, town and XP only. Squeegee references and contact details remain private." : "Public entries show a pseudonymous customer reference, town and XP, never names or full addresses. Contact details remain private."}
        </small>
      </div>
    </section>
  );
}
