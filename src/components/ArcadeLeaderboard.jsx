import React, { useEffect, useRef, useState } from "react";

const REFRESH_MS = 10000;
const ENDPOINT = "/.netlify/functions/arcadeLeaderboard";
const CLAIM_ENDPOINT = "/.netlify/functions/arcadeClaimBooking";

export default function ArcadeLeaderboard() {
  const [players, setPlayers] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [connection, setConnection] = useState("connecting");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [changes, setChanges] = useState({});
  const previousPlayers = useRef(null);
  const [localScore, setLocalScore] = useState({ points: 0, registered: false });
  const [claimEmail, setClaimEmail] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [claimStep, setClaimStep] = useState("email");
  const [claimProof, setClaimProof] = useState("");
  const [claimConsent, setClaimConsent] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");
  const [claimError, setClaimError] = useState("");

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

  const requestClaim = async () => {
    if (!claimEmail.trim()) return;
    setClaimLoading(true);
    setClaimError("");
    setClaimMessage("");
    try {
      const response = await fetch(CLAIM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", email: claimEmail.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to send verification code");
      setClaimStep("code");
      setClaimMessage("If a recent booking matches that email, we've sent a six-digit verification code. Check your inbox.");
    } catch (error) {
      setClaimError(error.message || "Unable to verify booking right now.");
    } finally {
      setClaimLoading(false);
    }
  };

  const verifyClaim = async () => {
    if (!/^\d{6}$/.test(claimCode.trim())) {
      setClaimError("Enter the six-digit code from your email.");
      return;
    }
    setClaimLoading(true);
    setClaimError("");
    setClaimMessage("");
    try {
      const response = await fetch(CLAIM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm", email: claimEmail.trim(), code: claimCode.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.bookingProof) {
        throw new Error(data.error || "Couldn't verify this booking.");
      }
      setClaimProof(data.bookingProof);
      setClaimStep("verified");
      setClaimMessage("Booking verified! You're ready to join the global leaderboard.");
    } catch (error) {
      setClaimError(error.message || "Unable to verify booking right now.");
    } finally {
      setClaimLoading(false);
    }
  };

  const joinAfterClaim = async () => {
    if (!claimConsent || !claimProof) return;
    setClaimLoading(true);
    setClaimError("");
    try {
      const register = window.n64Score?.registerEntry;
      if (typeof register !== "function") {
        throw new Error("Please reload Preview 1 to load the updated XP scoreboard.");
      }
      const entry = await register(claimProof);
      setClaimStep("joined");
      setClaimProof("");
      setClaimCode("");
      setClaimEmail("");
      setClaimConsent(false);
      setClaimMessage("You're on the global leaderboard as " + entry.displayName + "!");
    } catch (error) {
      setClaimError(error.message || "Unable to join the leaderboard right now.");
    } finally {
      setClaimLoading(false);
    }
  };

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

        <div className="n64-your-score" aria-label="Your device score">
          <div><strong>★ YOUR SCORE</strong><span>{localScore.points.toLocaleString("en-GB")} XP</span></div>
          <small>{localScore.registered
            ? "Your booking is registered. New level points sync to the global leaderboard."
            : "Your XP is saved on this device. Already booked? Verify your booking below to add your name to the global rankings."}</small>
        </div>

        {!localScore.registered && (
          <div className="n64-claim-booking" aria-label="Join leaderboard after an existing booking">
            <h3>★ ALREADY BOOKED? JOIN THE BOARD!</h3>
            {claimStep === "email" && (
              <form onSubmit={(event) => { event.preventDefault(); void requestClaim(); }}>
                <label htmlFor="n64-claim-email">Email address used for your booking</label>
                <input id="n64-claim-email" type="email" required
                  autoComplete="email" placeholder="you@example.com"
                  value={claimEmail} onChange={(event) => setClaimEmail(event.target.value)}
                  disabled={claimLoading} />
                <button type="submit" disabled={claimLoading}>
                  {claimLoading ? "Checking booking…" : "Verify my booking"}
                </button>
              </form>
            )}
            {claimStep === "code" && (
              <form onSubmit={(event) => { event.preventDefault(); void verifyClaim(); }}>
                <label htmlFor="n64-claim-code">Six-digit code sent to your booking email</label>
                <input id="n64-claim-code" type="text" inputMode="numeric"
                  pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code"
                  placeholder="123456" value={claimCode}
                  onChange={(event) => setClaimCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={claimLoading} />
                <button type="submit" disabled={claimLoading}>
                  {claimLoading ? "Verifying…" : "Confirm my booking"}
                </button>
                <button type="button" className="n64-claim-secondary"
                  onClick={() => { setClaimStep("email"); setClaimError(""); setClaimMessage(""); }}
                  disabled={claimLoading}>Use a different email</button>
              </form>
            )}
            {claimStep === "verified" && (
              <div className="n64-claim-consent">
                <label htmlFor="n64-prize-consent">
                  <input type="checkbox" id="n64-prize-consent" checked={claimConsent}
                    onChange={(event) => setClaimConsent(event.target.checked)} />
                  <span>I agree to show my booking name and XP on the public leaderboard and
                    to be contacted privately using my booking details if I win a prize.</span>
                </label>
                <button type="button" onClick={() => void joinAfterClaim()}
                  disabled={claimLoading || !claimConsent}>
                  {claimLoading ? "Joining…" : "★ Join the leaderboard"}
                </button>
              </div>
            )}
            <div className="n64-claim-messages" aria-live="polite">
              {claimMessage && <span className="n64-claim-success">{claimMessage}</span>}
              {claimError && <span className="n64-claim-error" role="alert">{claimError}</span>}
            </div>
            <small>No new booking needed. We'll email a code to verify a booking made in the last 14 days. Your contact details are never shown publicly.</small>
          </div>
        )}

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
          Only customers who book and opt in appear here. Contact details remain private.
        </small>
      </div>
    </section>
  );
}
