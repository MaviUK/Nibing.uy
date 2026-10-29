import React, { useEffect, useState } from "react";

export default function ArcadeLeaderboard() {
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/.netlify/functions/arcadeLeaderboard", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("Unavailable"); return r.json(); })
      .then((json) => { if (active) setPlayers(Array.isArray(json.entries) ? json.entries.slice(0,10) : []); })
      .catch(() => { if(active) setError(true); });
    return () => { active = false; };
  }, []);

  return (
    <section className="n64-public-leaderboard" aria-labelledby="n64-board-title">
      <div className="n64-public-board-inner">
        <span className="n64-board-eyebrow">★ HIGH SCORES ★</span>
        <h2 id="n64-board-title">Global Leaderboard</h2>
        <p>Complete the levels, collect XP, then opt in after booking to appear on the board.</p>
        {error ? <p>Leaderboard currently unavailable. Your local score is unaffected.</p> :
          <ol aria-label="Top ten players">
            {!players.length ? <li><span>Be the first player on the board!</span></li> :
              players.map((player, i) => (
                <li key={String(i)+"-"+player.name}>
                  <span><strong>{String(i+1).padStart(2,"0")}</strong> {player.name}</span>
                  <strong>{Number(player.points||0).toLocaleString("en-GB")} XP</strong>
                </li>
              ))}
          </ol>
        }
        <small>Public scores show names only. Prize contact details are never published.</small>
      </div>
    </section>
  );
}
