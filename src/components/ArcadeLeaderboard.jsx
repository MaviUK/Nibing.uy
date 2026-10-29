import React, { useEffect, useState } from "react";

/** Public scoreboard. Only an opted-in booking customer's name and XP appear. */
export default function ArcadeLeaderboard() {
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let mounted = true;
    let busy = false;

    const refresh = async () => {
      if (!mounted || busy) return;
      busy = true;
      try {
        const response = await fetch("/.netlify/functions/arcadeLeaderboard", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Leaderboard unavailable");
        const data = await response.json();
        if (!mounted) return;
        setPlayers(Array.isArray(data.entries) ? data.entries.slice(0, 10) : []);
        setStatus("ready");
      } catch (_) {
        if (mounted) setStatus("error");
      } finally {
        busy = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    // Rankings update when a player joins on this device and while other
    // visitors join on separate phones. No continuous network connection.
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    window.addEventListener("n64:leaderboard-updated", refresh);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("n64:leaderboard-updated", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <section className="n64-public-leaderboard" aria-labelledby="n64-board-title">
      <div className="n64-public-board-inner">
        <span className="n64-board-eyebrow">★ HIGH SCORES ★</span>
        <h2 id="n64-board-title">Global Leaderboard</h2>
        <p>Earn XP across the levels, then book a clean and opt in to join the rankings.</p>
        <ol aria-label="Top ten players" aria-live="polite">
          {status === "loading" && !players.length ? (
            <li><span>Loading player scores…</span></li>
          ) : !players.length ? (
            <li><span>Be the first player on the board!</span></li>
          ) : players.map((player, i) => (
            <li key={String(player.rank || i + 1) + "-" + player.name}>
              <span><strong>{String(i + 1).padStart(2, "0")}</strong> {player.name}</span>
              <strong>{Number(player.points || 0).toLocaleString("en-GB")} XP</strong>
            </li>
          ))}
        </ol>
        {status === "error" && (
          <p className="n64-board-error" role="status">
            Live rankings are temporarily unavailable; your local XP is unaffected.
          </p>
        )}
        <small>
          Top 10 rankings refresh automatically. Only opted-in players' names and
          scores appear here. Private booking and prize contact details are not published.
        </small>
      </div>
    </section>
  );
}
