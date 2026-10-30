import React, { useEffect, useRef, useState } from "react";

const REFRESH_MS = 10000;
const ENDPOINT = "/.netlify/functions/arcadeLeaderboard";

/**
 * Real visitors share one global board.
 * Polls every 10s while the tab is visible, with immediate refresh after
 * booking/XP updates. Private prize-contact details never reach this view.
 */
export default function ArcadeLeaderboard() {
  const [players, setPlayers] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [connection, setConnection] = useState("connecting");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [changes, setChanges] = useState({});
  const previousPlayers = useRef(null);

  useEffect(() => {
    let mounted = true;
    let busy = false;
    let refreshAgain = false;

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
              name: String(p.name || "Player").slice(0, 45),
              points: Number(p.points || 0),
            }))
          : [];

        if (previousPlayers.current !== null) {
          const before = previousPlayers.current;
          const movement = {};
          next.forEach((player) => {
            const old = before.find((p) => p.name === player.name);
            if (!old) movement[player.name] = "new";
            else if (old.rank > player.rank) movement[player.name] = "up";
            else if (old.rank < player.rank) movement[player.name] = "down";
            else if (old.points !== player.points) movement[player.name] = "points";
          });
          setChanges(movement);
        }
        previousPlayers.current = next;
        setPlayers(next);
        setTotalPlayers(Number.isFinite(Number(data.totalPlayers))
          ? Math.max(0, Number(data.totalPlayers)) : next.length);
        setUpdatedAt(new Date());
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

    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }

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
            {connection === "live" ? "LIVE" : connection === "connecting" ? "CONNECTING" : "RECONNECTING"}
          </span>
        </div>
        <h2 id="n64-board-title">Global Leaderboard</h2>
        <p>Watch the high scores change as players book bins and collect XP.</p>
        <div className="n64-live-board-stats">
          <strong>{totalPlayers.toLocaleString("en-GB")} {totalPlayers === 1 ? "PLAYER" : "PLAYERS"}</strong>
          <span>{connection === "live" && updatedAt
            ? "Updated " + updatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : "Checking scores…"}
          </span>
        </div>
        <ol aria-label="Live top ten players">
          {connection === "connecting" && !players.length ? (
            <li><span>Connecting to the leaderboard…</span></li>
          ) : !players.length && connection === "live" ? (
            <li><span>Be the first player on the board!</span></li>
          ) : players.map((player, i) => {
            const change = changes[player.name];
            return (
              <li key={player.rank + "-" + player.name}
                className={change ? "n64-board-row n64-board-row--" + change : "n64-board-row"}>
                <span><strong>{String(i + 1).padStart(2, "0")}</strong> {player.name}</span>
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
            Connection interrupted. Showing the last available scores and reconnecting automatically.
          </p>
        )}
        <small>
          Scores refresh automatically every 10 seconds while this page is open.
          Only customers who book and opt in appear here. Contact details remain private.
        </small>
      </div>
    </section>
  );
}
