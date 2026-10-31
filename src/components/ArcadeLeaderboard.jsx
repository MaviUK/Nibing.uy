import React, { useEffect, useRef, useState } from "react";

const REFRESH_MS = 10000;
const ENDPOINT = "/.netlify/functions/arcadeLeaderboard";

export default function ArcadeLeaderboard() {
  const [players, setPlayers] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [connection, setConnection] = useState("connecting");
  const [updatedAt, setUpdatedAt] = useState(null);
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
            {connection === "live" ? "LIVE" : connection === "connecting" ? "CONNECTING" : "RECONNECTING"}
          </span>
        </div>
        <h2 id="n64-board-title">Global Leaderboard</h2>
        <p>High scores update automatically as customers complete bookings and collect XP.</p>

        <div className="n64-your-score" aria-label="Your device score">
          <div><strong>★ YOUR SCORE</strong><span>{localScore.points.toLocaleString("en-GB")} XP</span></div>
          <small>{localScore.registered
            ? "Your booking is registered. New level points sync to the global leaderboard."
            : "Your XP stays on this device until a verified booking is linked. After a booking, your name and score are added automatically unless you choose to stay private."}</small>
        </div>


        <div className="n64-live-board-stats">
          <strong>{updatedAt ? totalPlayers.toLocaleString("en-GB") + (totalPlayers === 1 ? " PLAYER" : " PLAYERS") : "— PLAYERS"}</strong>
          <span>{connection === "live" && updatedAt
            ? "Updated " + updatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : "Checking scores…"}
          </span>
        </div>
        <ol aria-label="Live top ten players">
          {!players.length ? (
            <li><span>{connection === "live" ? "No registered players yet — be the first!" : "Waiting for live scores…"}</span></li>
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
            The leaderboard server is temporarily unavailable. Your device XP is unaffected; retrying automatically.
          </p>
        )}
        <small>
          Scores refresh automatically every 10 seconds while this page is open.
          Confirmed customers appear automatically unless they opt out during booking. Only names and XP are public; contact details remain private.
        </small>
      </div>
    </section>
  );
}
