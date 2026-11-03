import React, { useEffect, useRef, useState } from "react";

const BINS = [
  { key: "BLACK", label: "Black bin", dot: "bg-zinc-900", border: "border-zinc-300" },
  { key: "BROWN", label: "Brown / Green bin", dot: "bg-amber-800", border: "border-amber-500/50" },
  { key: "BLUE", label: "Blue bin", dot: "bg-blue-600", border: "border-blue-500/50" },
];

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function normalisePostcode(raw) {
  const compact = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length > 3 ? compact.slice(0, -3) + " " + compact.slice(-3) : compact;
}

function isValidPostcode(postcode) {
  return /^BT\d{1,2}[A-Z\d]?\s\d[A-Z]{2}$/.test(postcode);
}

function normaliseAddresses(payload) {
  let list = payload?.data?.addresses;
  if (!Array.isArray(list)) list = payload?.addresses;
  if (!Array.isArray(list) && list && typeof list === "object") list = Object.values(list);
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  return list.map((item) => {
    if (!item || typeof item !== "object") return null;
    const uprn = String(item.uprn || item.UPRN || "").trim();
    const label = String(item.addressText || item.address || item.label || "").trim();
    if (!uprn || !label || seen.has(uprn)) return null;
    seen.add(uprn);
    return { uprn, label };
  }).filter(Boolean);
}

function binKey(value) {
  const text = String(value || "").toUpperCase();
  if (text.includes("BLACK") || text.includes("GREY") || text.includes("GRAY")) return "BLACK";
  if (text.includes("BROWN") || text.includes("GREEN")) return "BROWN";
  if (text.includes("BLUE")) return "BLUE";
  return "";
}

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const date = new Date(String(value) + "T12:00:00Z");
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

export default function CoverageChecker({ onBook, compact = false, onClose }) {
  const [postcode, setPostcode] = useState("");
  const [status, setStatus] = useState("idle");
  const [checkedPostcode, setCheckedPostcode] = useState("");
  const [town, setTown] = useState("");
  const [addresses, setAddresses] = useState([]);
  const [selectedUprn, setSelectedUprn] = useState("");
  const [dates, setDates] = useState(null);
  const [checkingDates, setCheckingDates] = useState(false);
  const [message, setMessage] = useState("");
  const controllerRef = useRef(null);
  const sequenceRef = useRef(0);

  useEffect(() => () => {
    sequenceRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  function changePostcode(value) {
    sequenceRef.current += 1;
    controllerRef.current?.abort();
    setPostcode(String(value || "").toUpperCase());
    setStatus("idle");
    setCheckedPostcode("");
    setTown("");
    setAddresses([]);
    setSelectedUprn("");
    setDates(null);
    setCheckingDates(false);
    setMessage("");
  }

  async function fetchDates(address, pc, sequence, signal) {
    setCheckingDates(true);
    setDates(null);
    setMessage("");
    try {
      const response = await fetch("/api/booking-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: address.label,
          postcode: pc,
          bins: [{ type: "Black Bin" }, { type: "Brown Bin" }, { type: "Blue Bin" }],
        }),
        signal,
      });
      const data = await response.json().catch(() => null);
      if (sequence !== sequenceRef.current) return;

      if (!response.ok || !Array.isArray(data?.results)) {
        setDates({ results: [] });
        setMessage("We cover this address, but couldn't verify the next dates automatically. We can confirm them when you book.");
        return;
      }

      setDates(data);
      if (!data.results.some((item) => item?.automatic && item?.assignedCleanDate)) {
        setMessage("We cover this address. Please book and we'll confirm the next available clean dates.");
      } else if (!data.results.every((item) => item?.automatic && item?.assignedCleanDate)) {
        setMessage("Some dates need manual confirmation. You can still book any of these bins.");
      }
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== sequenceRef.current) return;
      setDates({ results: [] });
      setMessage("We couldn't check the next dates right now. We can confirm them when you book.");
    } finally {
      if (sequence === sequenceRef.current) setCheckingDates(false);
    }
  }

  async function findAddresses(pc, sequence, signal) {
    let list = [];
    try {
      const response = await fetch(
        "/.netlify/functions/binAddresses?postcode=" + encodeURIComponent(pc),
        { signal }
      );
      const data = await response.json().catch(() => null);
      if (response.ok) list = normaliseAddresses(data);
    } catch (error) {
      if (error?.name === "AbortError") return;
    }

    if (!list.length) {
      try {
        const response = await fetch(
          "/.netlify/functions/binLookup?postcode=" + encodeURIComponent(pc),
          { signal }
        );
        const data = await response.json().catch(() => null);
        if (response.ok) list = normaliseAddresses(data);
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    if (sequence !== sequenceRef.current) return;
    setAddresses(list);

    if (!list.length) {
      setMessage("We cover this postcode, but couldn't retrieve the council address list. You can still book and we'll confirm your dates.");
    } else if (list.length === 1) {
      setSelectedUprn(list[0].uprn);
      await fetchDates(list[0], pc, sequence, signal);
    } else {
      setMessage("Choose your address below to see the next clean for each bin.");
    }
  }

  async function checkPostcode(event) {
    event.preventDefault();
    controllerRef.current?.abort();
    const sequence = ++sequenceRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const pc = normalisePostcode(postcode);

    setPostcode(pc);
    setCheckedPostcode("");
    setTown("");
    setAddresses([]);
    setSelectedUprn("");
    setDates(null);
    setCheckingDates(false);
    setMessage("");

    if (!isValidPostcode(pc)) {
      setStatus("invalid");
      setMessage("Please enter a full Northern Ireland postcode, for example BT20 5NF.");
      return;
    }

    setStatus("checking");
    try {
      const response = await fetch(
        "/.netlify/functions/serviceAreaPostcode?postcode=" + encodeURIComponent(pc),
        { signal: controller.signal }
      );
      const data = await response.json().catch(() => null);
      if (sequence !== sequenceRef.current) return;

      if (!response.ok || data?.valid !== true) {
        setStatus("error");
        setMessage("We couldn't verify that postcode. Please check it and try again.");
        return;
      }

      // Award once for an actual verified postcode lookup, covered or not.
      window.n64Score?.awardAction("coverage");
      setCheckedPostcode(data.postcode || pc);
      if (data.covered !== true) {
        setStatus("outside");
        return;
      }

      setTown(data.town || "your area");
      setStatus("covered");
      await findAddresses(pc, sequence, controller.signal);
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== sequenceRef.current) return;
      setStatus("error");
      setMessage("The postcode checker is unavailable right now. Please try again or contact us.");
    }
  }

  function chooseAddress(uprn) {
    controllerRef.current?.abort();
    const sequence = ++sequenceRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setSelectedUprn(uprn);
    setDates(null);
    setMessage("");
    setCheckingDates(false);
    const chosen = addresses.find((address) => address.uprn === uprn);
    if (chosen) void fetchDates(chosen, checkedPostcode, sequence, controller.signal);
  }

  const chosenAddress = addresses.find((address) => address.uprn === selectedUprn);
  const confirmedCount = Array.isArray(dates?.results)
    ? dates.results.filter((item) => item?.automatic && item?.assignedCleanDate).length
    : 0;

  function openBooking() {
    let address = chosenAddress?.label || "";
    if (address && checkedPostcode && !address.toUpperCase().replace(/\s+/g, "").includes(checkedPostcode.toUpperCase().replace(/\s+/g, ""))) {
      address += ", " + checkedPostcode;
    }
    onBook(address);
  }

  return (
    <section aria-label="Check bin cleaning coverage" className={compact ? "relative w-full rounded-xl bg-zinc-900 p-4 sm:p-5 text-left" : "relative w-full max-w-2xl mt-5 rounded-2xl border border-green-500/40 bg-zinc-900/95 p-4 sm:p-5 shadow-2xl text-left"}>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close coverage checker"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-2xl leading-none text-zinc-300 hover:bg-zinc-800 hover:text-white"
        >
          ×
        </button>
      )}
      <h2 id="coverage-checker-title" className="pr-9 text-lg sm:text-xl font-extrabold text-white">Do we cover your area?</h2>
      <p className="text-sm text-zinc-300 mt-1">
        Enter your postcode to check coverage and our next black, brown/green and blue bin cleaning dates.
      </p>
      <form className="mt-4 flex flex-col sm:flex-row gap-2" onSubmit={checkPostcode}>
        <label htmlFor="home-coverage-postcode" className="sr-only">Your postcode</label>
        <input
          id="home-coverage-postcode"
          type="text"
          value={postcode}
          onChange={(event) => changePostcode(event.target.value)}
          placeholder="e.g. BT20 5NF"
          autoComplete="postal-code"
          autoCapitalize="characters"
          maxLength={9}
          aria-invalid={status === "invalid"}
          aria-describedby="home-coverage-help"
          className="min-w-0 flex-1 rounded-xl border border-zinc-500 bg-white px-4 py-3 text-base font-medium text-zinc-900 placeholder-zinc-500 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <button type="submit" disabled={status === "checking"} className="rounded-xl bg-green-500 px-5 py-3 font-extrabold text-black transition hover:bg-green-400 focus:outline-none focus:ring-2 focus:ring-green-300 disabled:opacity-60">
          {status === "checking" ? "Checking..." : "Check postcode"}
        </button>
      </form>
      <p id="home-coverage-help" className="mt-2 text-xs text-zinc-400">
        Cleaning dates are shown for your address, not just the postcode, to avoid giving you the wrong bin day.
      </p>

      <div aria-live="polite">
        {status === "checking" && (
          <p className="mt-4 text-sm text-zinc-300" role="status">Checking your area...</p>
        )}
        {(status === "invalid" || status === "error") && (
          <p className="mt-4 rounded-xl border border-amber-400/50 bg-amber-950/40 p-3 text-sm text-amber-100" role="alert">{message}</p>
        )}
        {status === "outside" && (
          <div className="mt-4 rounded-xl border border-zinc-600 bg-zinc-800 p-4">
            <p className="font-bold text-white">Sorry, we don't cover {checkedPostcode} at the moment.</p>
            <p className="mt-1 text-sm text-zinc-300">Please check back as we expand our cleaning rounds.</p>
          </div>
        )}
        {status === "covered" && (
          <div className="mt-4 space-y-3">
            <p className="rounded-xl border border-green-500/50 bg-green-950/40 p-3 font-bold text-green-200">
              <span aria-hidden="true">✓ </span> Yes! We cover {town}.
            </p>

            {addresses.length > 1 && (
              <div>
                <label htmlFor="home-coverage-address" className="mb-2 block text-sm font-semibold text-white">
                  Select your address for accurate clean dates
                </label>
                <select
                  id="home-coverage-address"
                  value={selectedUprn}
                  onChange={(event) => chooseAddress(event.target.value)}
                  className="w-full min-w-0 rounded-xl border border-zinc-500 bg-white px-3 py-3 text-base text-zinc-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Choose your address...</option>
                  {addresses.map((address) => <option key={address.uprn} value={address.uprn}>{address.label}</option>)}
                </select>
              </div>
            )}

            {addresses.length === 1 && <p className="text-xs text-zinc-300">Address: {addresses[0].label}</p>}
            {!addresses.length && status === "covered" && !message && <p className="text-sm text-zinc-300">Finding council addresses...</p>}
            {checkingDates && <p className="text-sm text-zinc-300" role="status">Checking next cleaning dates...</p>}

            {dates && !checkingDates && (
              <div>
                <p className="mb-2 text-sm font-semibold text-white">Next available clean dates</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {BINS.map((bin) => {
                    const match = dates.results?.find((item) => binKey(item?.bin) === bin.key);
                    const nextDate = match?.automatic ? formatDate(match.assignedCleanDate) : "";
                    return (
                      <div key={bin.key} className={"rounded-xl border bg-zinc-950/70 p-3 " + bin.border}>
                        <div className="flex items-center gap-2 text-xs font-bold text-white">
                          <span className={"h-3.5 w-3.5 shrink-0 rounded-full border border-white/40 " + bin.dot} aria-hidden="true" />
                          {bin.label}
                        </div>
                        <p className={"mt-2 text-sm font-bold " + (nextDate ? "text-green-300" : "text-zinc-300")}>
                          {nextDate || "To be confirmed"}
                        </p>
                      </div>
                    );
                  })}
                </div>
                {confirmedCount > 0 && (
                  <p className="mt-2 text-xs text-zinc-400">
                    Dates are indicative and subject to availability until your booking is confirmed.
                  </p>
                )}
              </div>
            )}

            {message && <p className="text-sm text-amber-200">{message}</p>}
            <button type="button" onClick={openBooking} className="w-full rounded-xl bg-green-500 px-5 py-3 font-extrabold text-black hover:bg-green-400 focus:outline-none focus:ring-2 focus:ring-green-300">
              Book a Clean
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
