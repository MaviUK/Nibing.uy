import React, { useEffect, useMemo, useRef, useState } from "react";

/* =========================
   Time + Utility Functions
   ========================= */
const TZ = "Europe/London";

// Round to nearest centisecond between two high-res timestamps (ms)
function computeCentiseconds(startMs, stopMs) {
  const deltaMs = Math.max(0, stopMs - startMs);
  return Math.round(deltaMs / 10); // 9,999ms -> 1000 cs; 10,005ms -> 1001 cs
}

// Today key in Europe/London, e.g. "2025-09-19"
function getTodayKey() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const parts = Object.fromEntries(fmt.map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Lazy-load Google Places if not available yet
let googleLoaderPromise = null;
function loadGooglePlaces(apiKey) {
  if (window.google?.maps?.places) return Promise.resolve(window.google);

  if (!googleLoaderPromise) {
    googleLoaderPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        apiKey
      )}&libraries=places`;
      s.async = true;
      s.onerror = () => reject(new Error("Failed to load Google Maps JS"));
      s.onload = () => {
        if (window.google?.maps?.places) resolve(window.google);
        else reject(new Error("Google Maps Places not available"));
      };
      document.head.appendChild(s);
    });
  }
  return googleLoaderPromise;
}

/* =========================
   Metrics (Netlify Function)
   ========================= */
// fire-and-forget; don’t block UI if it fails
async function postMetric(kind) {
  try {
    const res = await fetch("/.netlify/functions/tensec-metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const txt = await res.text();
    console.log("[metrics POST]", kind, res.status, txt);
  } catch (e) {
    console.log("[metrics POST error]", kind, e);
  }
}

/* =========================
   Component
   ========================= */
export default function TenSecondChallenge({ debug = false, autoWin = false }) {
  const [elapsedCs, setElapsedCs] = useState(0);
  const [running, setRunning] = useState(false);
  const [hasTriedToday, setHasTriedToday] = useState(false); // single attempt per device/day
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showWinModal, setShowWinModal] = useState(false);

  // Winner form (prize is 1 bin)
  const [form, setForm] = useState({
    binType: "Black Bin",
    name: "",
    email: "",
    phone: "",
    address: "",
  });
  const [winSubmitStatus, setWinSubmitStatus] = useState("idle"); // idle | sending | success | error
  const [winSubmitErrorText, setWinSubmitErrorText] = useState("");
  const [winnerSchedule, setWinnerSchedule] = useState(null);

  // Places refs
  const winAddressRef = useRef(null);
  const winSelectedPlaceRef = useRef(null);
  const [winPlaceId, setWinPlaceId] = useState(null);

  const rafRef = useRef(null);
  const startRef = useRef(0);
  const attemptPostedRef = useRef(false);
  const todayKey = useMemo(() => getTodayKey(), []);

  // Load the "one try per day" flag
  useEffect(() => {
    const tried =
      typeof window !== "undefined"
        ? localStorage.getItem(`tensec_try_${todayKey}`)
        : null;
    setHasTriedToday(!!tried);
  }, [todayKey]);

  // Spacebar: ignore while typing or when modal open
  useEffect(() => {
    const onKeyDown = (e) => {
      const isSpace =
        e.code === "Space" || e.key === " " || e.key === "Spacebar";
      if (!isSpace) return;

      const t = e.target;
      const isTyping =
        t?.tagName === "INPUT" ||
        t?.tagName === "TEXTAREA" ||
        t?.isContentEditable;

      if (isTyping || showWinModal) return;
      e.preventDefault();
      handleStartStop();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, hasTriedToday, showWinModal, autoWin]);

  function tick(now) {
    const cs = computeCentiseconds(startRef.current, now);
    setElapsedCs(cs);
    rafRef.current = requestAnimationFrame(tick);
  }

  function handleStartStop() {
    // Only enforce one attempt per day (unless autoWin testing)
    if (!autoWin && hasTriedToday) return;

    if (!running) {
      // START: record an attempt (skip in autoWin test mode)
      if (!autoWin) {
        postMetric("attempt");
        attemptPostedRef.current = true;
      }

      setError("");
      setMessage("");
      setElapsedCs(0);
      startRef.current = performance.now();
      setRunning(true);
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const rawFinalCs = computeCentiseconds(startRef.current, performance.now());
      const finalCs = autoWin ? 1000 : rawFinalCs;

      setElapsedCs(finalCs);
      setRunning(false);

      // Backstop: if start POST didn't happen for any reason
      if (!autoWin && !attemptPostedRef.current) postMetric("attempt");
      attemptPostedRef.current = false;

      // Mark that today's single chance was used
      if (typeof window !== "undefined") {
        localStorage.setItem(`tensec_try_${todayKey}`, "1");
      }
      setHasTriedToday(true);

      if (finalCs === 1000) {
        // WIN: record a win (skip in autoWin test mode)
        if (!autoWin) postMetric("win");

        setWinnerSchedule(null);
        setShowWinModal(true);
        setMessage("You nailed 10.00 seconds! 🎉");
      } else {
        setMessage("So close! Try again tomorrow.");
      }
    }
  }

  // Attach Places inside the winner modal
  useEffect(() => {
    if (!showWinModal) return;
    const key = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) return;

    let ac;
    let cleanup = () => {};
    loadGooglePlaces(key)
      .then((google) => {
        if (!winAddressRef.current) return;
        ac = new google.maps.places.Autocomplete(winAddressRef.current, {
          componentRestrictions: { country: ["gb"] },
          fields: [
            "place_id",
            "formatted_address",
            "address_components",
            "name",
            "geometry",
          ],
          types: ["address"],
        });
        const listener = ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          winSelectedPlaceRef.current = place;
          setWinPlaceId(place.place_id || null);
          const formatted = place.formatted_address || place.name || "";
          setForm((f) => ({ ...f, address: formatted }));
        });
        cleanup = () => listener.remove();
      })
      .catch((e) => console.warn("Places failed to load (winner):", e));

    return () => cleanup();
  }, [showWinModal]);

  async function submitBooking(e) {
    e.preventDefault();

    if (
      !form.name ||
      !form.email ||
      !form.phone ||
      !form.address ||
      !form.binType
    ) {
      setError("Please complete all required fields.");
      return;
    }

    setError("");
    setWinSubmitErrorText("");
    setWinnerSchedule(null);
    setWinSubmitStatus("sending");

    const loc = winSelectedPlaceRef.current?.geometry?.location;
    const lat = loc ? loc.lat() : null;
    const lng = loc ? loc.lng() : null;

    const payload = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      address: form.address,
      bins: [{ type: form.binType, count: 1, frequency: "Prize (Free Clean)" }],
      placeId: winPlaceId,
      lat,
      lng,
      source: "ten-second-challenge",
    };

    try {
      const res = await fetch("/.netlify/functions/sendChallengeWinnerEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text().catch(() => "");
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {}

      if (res.ok) {
        setWinnerSchedule({
          matched: Boolean(data.scheduleMatched),
          assignedCleanDate: data.assignedCleanDate || null,
          formattedCleanDate: data.formattedCleanDate || null,
          customerConfirmationSent: data.customerConfirmationSent !== false,
        });
        setWinSubmitStatus("success");
      } else {
        console.error("Winner email failed:", res.status, text);
        setWinSubmitErrorText(data?.error || "");
        setError("We couldn't submit your winner booking. Please try again or contact us.");
        setWinSubmitStatus("error");
      }
    } catch (err) {
      console.error(err);
      setError("Network error submitting your winner booking. Please try again.");
      setWinSubmitStatus("error");
    }
  }

  const seconds = (elapsedCs / 100).toFixed(2);

  // (Optional) debug check
  useEffect(() => {
    if (!debug) return;
    const cases = [
      { start: 0, stop: 10000, expect: 1000 },
      { start: 0, stop: 9999, expect: 1000 },
      { start: 0, stop: 10005, expect: 1001 },
      { start: 42, stop: 1042, expect: 100 },
    ];
    // eslint-disable-next-line no-console
    console.table(
      cases.map((c) => ({
        ...c,
        got: computeCentiseconds(c.start, c.stop),
        pass: computeCentiseconds(c.start, c.stop) === c.expect,
      }))
    );
  }, [debug]);

  return (
    <div className="w-full max-w-3xl mx-auto p-4" data-testid="ten-sec-root">
      <div className="bg-neutral-900 text-white rounded-2xl p-6 md:p-8 shadow-xl border border-neutral-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold">
              10-Second Stop Watch Challenge
            </h2>
            <p className="text-xs md:text-sm opacity-80">
              Stop the timer on exactly <strong>10.00s</strong> to win a free bin clean.</p>
             <p className="text-xs md:text-sm opacity-80">
              Only Available in Donaghdee, Newtownards, Portaferry, Millisle, Comber (and close surrounding areas)</p>
          </div>
          <div className="text-xs opacity-80 text-right">
            One try per device · Europe/London
          </div>
        </div>

        {autoWin && (
          <div className="mt-3 bg-amber-900/30 border border-amber-700 text-amber-200 text-xs px-3 py-2 rounded-lg">
            Testing mode is <strong>ON</strong>: stopping the timer will count as
            a win and display 10.00s.
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          {/* Display */}
          <div className="flex flex-col items-center justify-center bg-black/40 rounded-2xl p-8 border border-neutral-800">
            <div className="text-sm uppercase tracking-widest opacity-70">
              Target
            </div>
            <div className="text-5xl md:text-6xl font-extrabold">10.00s</div>

            <div className="mt-6 text-sm uppercase tracking-widest opacity-70">
              Your Time
            </div>
            <div
              className={`text-6xl md:text-7xl font-mono tabular-nums ${
                seconds === "10.00" ? "text-emerald-400" : ""
              }`}
            >
              {seconds}s
            </div>

            <div className="mt-6 text-xs text-center opacity-70">
              Press <span className="font-semibold">Space</span> (desktop) or use
              the <span className="font-semibold">Start/Stop</span> button.
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4">
            {hasTriedToday ? (
              <div className="bg-amber-900/30 border border-amber-800 text-amber-200 p-4 rounded-xl">
                You&apos;ve used your attempt for {todayKey} on this device. Try
                again tomorrow.
              </div>
            ) : (
              <div className="bg-emerald-900/30 border border-emerald-800 text-emerald-200 p-4 rounded-xl">
                Ready when you are — hit Space or click the big button below.
              </div>
            )}

            <button
              onClick={handleStartStop}
              disabled={!autoWin && hasTriedToday}
              className={`w-full rounded-2xl py-6 text-xl font-semibold shadow-lg border transition active:scale-[0.99]
                ${
                  running
                    ? "bg-rose-600 hover:bg-rose-500 border-rose-400"
                    : "bg-emerald-600 hover:bg-emerald-500 border-emerald-400"
                }
                ${!autoWin && hasTriedToday ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {running ? "Stop" : "Start"}
            </button>

            {message && <div className="text-emerald-300 text-sm">{message}</div>}
            {error && <div className="text-red-300 text-sm">{error}</div>}

            <p className="text-xs opacity-60">
              Accuracy uses centiseconds. A win requires your displayed time to
              read exactly <span className="font-semibold">10.00s</span>.
            </p>
          </div>
        </div>
      </div>

      {/* Winner Booking Modal */}
      {showWinModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white text-black w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
            {winSubmitStatus === "success" ? (
              <div className="p-6">
                <h2 className="text-xl font-bold">You&apos;re all set! 🎉</h2>
                {winnerSchedule?.matched ? (
                  <>
                    <p className="text-sm text-neutral-700 mt-2">
                      Thanks, {form.name}. Your free {form.binType.toLowerCase()} clean has been booked automatically.
                    </p>
                    <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
                      <div className="text-xs font-bold uppercase tracking-wide">Your clean date</div>
                      <div className="mt-1 text-lg font-bold">{winnerSchedule.formattedCleanDate}</div>
                    </div>
                    <p className="text-sm text-neutral-700 mt-3">
                      A confirmation has been sent to <strong>{form.email}</strong>.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-neutral-700 mt-2">
                    Thanks, {form.name}. We’ve received your winner details and sent a confirmation to <strong>{form.email}</strong>. We couldn’t safely auto-match your clean date, so we’ll confirm it with you manually.
                  </p>
                )}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => {
                      setShowWinModal(false);
                      setMessage(
                        winnerSchedule?.matched
                          ? `Booked! Your free clean is ${winnerSchedule.formattedCleanDate}.`
                          : "Thanks! We'll be in touch to confirm your clean date."
                      );
                    }}
                    className="px-5 py-3 rounded-xl bg-black text-white hover:opacity-90"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-6 border-b">
                  <h3 className="text-xl font-bold">You&apos;re a winner! 🎉</h3>
                  <p className="text-sm text-neutral-600 mt-1">
                    Enter your details and we&apos;ll automatically match your free clean to the next suitable round in your area.
                  </p>
                </div>
                <form onSubmit={submitBooking} className="p-6 flex flex-col gap-4" noValidate>
                  <select
                    required
                    className="input"
                    value={form.binType}
                    onChange={(e) => setForm((f) => ({ ...f, binType: e.target.value }))}
                  >
                    <option value="Black Bin">Black</option>
                    <option value="Brown Bin">Brown</option>
                    <option value="Green Bin">Green</option>
                    <option value="Blue Bin">Blue</option>
                  </select>
                  <div className="text-sm text-neutral-600 -mt-2">
                    Prize: <span className="font-semibold">1 bin</span> clean
                  </div>

                  <input
                    required
                    className="input"
                    placeholder="Full name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                  <input
                    required
                    type="email"
                    className="input"
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                  <input
                    required
                    className="input"
                    placeholder="Phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />

                  <input
                    ref={winAddressRef}
                    required
                    className="input"
                    placeholder="Full address including postcode"
                    value={form.address}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({ ...f, address: v }));
                      setWinPlaceId(null);
                      winSelectedPlaceRef.current = null;
                    }}
                    autoComplete="off"
                    inputMode="text"
                  />
                  <div className="text-xs text-neutral-500 -mt-2">
                    Include your postcode so we can check the council collection day and match the correct round.
                  </div>

                  {error && (
                    <div className="text-red-600 text-sm">
                      {error}
                      {winSubmitStatus === "error" && winSubmitErrorText ? (
                        <div className="mt-1 text-xs opacity-80">Details: {winSubmitErrorText}</div>
                      ) : null}
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={winSubmitStatus === "sending"}
                      aria-busy={winSubmitStatus === "sending"}
                      className="flex-1 bg-black text-white rounded-xl py-3 font-semibold hover:opacity-90 active:opacity-80 disabled:opacity-60"
                    >
                      {winSubmitStatus === "sending" ? "Finding your clean date..." : "Book My Free Clean"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWinModal(false)}
                      className="px-4 py-3 rounded-xl bg-neutral-200 hover:bg-neutral-300"
                    >
                      Close
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tailwind @apply helper */}
      <style>{`
        .input { @apply w-full rounded-xl border border-neutral-500 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500; }
      `}</style>
    </div>
  );
}
