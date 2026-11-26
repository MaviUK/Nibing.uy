import React, { useEffect, useMemo, useRef, useState } from "react";
import BOOKING_TERMS from "../data/bookingTerms.json";
import { createFriendlyBookingReference } from "../bookingReference.mjs";
import BookingTermsContent from "../components/BookingTermsContent.jsx";

const TERMS_VERSION = BOOKING_TERMS.version;
const TERMS_TITLE = BOOKING_TERMS.title;
const TERMS_BODY = BOOKING_TERMS.body;

const PLANS = [
  { id: "domestic_4w", label: "4 Weekly", price: 5 },
  { id: "domestic_oneoff", label: "One-off", price: 15 },
  { id: "comm_lt360_4w", label: "Commercial <360L 4 Weekly", price: 5 },
  { id: "comm_lt360_oneoff", label: "Commercial <360L One-Off", price: 15 },
  { id: "comm_gt660_4w", label: "Commercial 660L+ 4 Weekly", price: 15 },
  { id: "comm_gt660_oneoff", label: "Commercial 660L+ One-Off", price: 45 },
];

const DEFAULT_BIN = { type: "", count: 1, planId: "domestic_4w", sizeLitres: null };

const isLargeCommercialPlan = (planId) =>
  planId === "comm_gt660_4w" || planId === "comm_gt660_oneoff";
const hasRequiredBinSize = (bin) =>
  !isLargeCommercialPlan(bin?.planId) ||
  bin.sizeLitres === 660 || bin.sizeLitres === 1100;

function money(value) {
  const amount = Math.round((Number(value) || 0) * 100) / 100;
  return amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2);
}

function loadGooglePlaces(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places) return resolve(window.google);
    const existing = document.querySelector("script[data-gmaps]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.dataset.gmaps = "1";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function loadRecaptchaV3(siteKey) {
  return new Promise((resolve, reject) => {
    if (!siteKey) return reject(new Error("Missing VITE_RECAPTCHA_SITE_KEY"));
    if (window.grecaptcha?.execute) return resolve(window.grecaptcha);
    const existing = document.getElementById("recaptcha-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.grecaptcha));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.id = "recaptcha-script";
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.grecaptcha);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function getRecaptchaToken(action) {
  const siteKey = import.meta.env?.VITE_RECAPTCHA_SITE_KEY;
  try {
    await loadRecaptchaV3(siteKey);
  } catch (error) {
    console.warn("reCAPTCHA failed to load:", error);
    return null;
  }
  if (!window.grecaptcha?.execute) return null;
  return new Promise((resolve) => {
    window.grecaptcha.ready(async () => {
      try {
        resolve(await window.grecaptcha.execute(siteKey, { action }));
      } catch (error) {
        console.warn("reCAPTCHA execute failed:", error);
        resolve(null);
      }
    });
  });
}

function TermsModal({ open, onClose, onConfirm }) {
  const scrollRef = useRef(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Every new opening requires the customer to read the terms again.
    setScrolledToEnd(false);
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
        setScrolledToEnd(true);
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-2 sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden border-2 border-slate-900 bg-white text-slate-900 shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="street-tos-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 id="street-tos-title" className="text-[17px] font-extrabold leading-snug sm:text-xl">
              {TERMS_TITLE}
            </h2>
            <p className="mt-1 text-xs text-slate-500">Version: {TERMS_VERSION}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center border border-slate-300 bg-white text-2xl leading-none text-slate-600 hover:bg-slate-100 hover:text-slate-950" aria-label="Close Terms">
            &times;
          </button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <BookingTermsContent body={TERMS_BODY} />
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6 sm:py-4">
          <p className="mb-2 text-xs leading-4 text-slate-600">
            {scrolledToEnd ? "You can now confirm your agreement." : "Scroll to the end to enable agreement."}
          </p>
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)] gap-2">
            <button type="button" onClick={onClose} className="min-h-11 w-full border-2 border-slate-900 bg-white px-3 py-2 text-sm font-bold text-slate-900 hover:bg-slate-100">
              Close
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!scrolledToEnd}
              aria-disabled={!scrolledToEnd}
              className="min-h-11 w-full border-2 border-slate-900 bg-[#ffd400] px-2 py-2 text-sm font-extrabold leading-5 text-slate-950 hover:bg-[#eac100] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Confirm &amp; Agree
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default function StreetBookingPage() {
  const [bins, setBins] = useState([{ ...DEFAULT_BIN }]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [placeId, setPlaceId] = useState(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsConfirmed, setTermsConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [staffPin, setStaffPin] = useState("");
  const [pinVerified, setPinVerified] = useState(false);
  const [pinError, setPinError] = useState("");
  const [checkingPin, setCheckingPin] = useState(false);
  const [binDayStatus, setBinDayStatus] = useState({state:"idle",results:[]});
  const addressInputRef = useRef(null);
  const selectedPlaceRef = useRef(null);

  useEffect(() => {
    document.title = "Street Signup | Ni Bin Guy";
    const key = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
    if (!pinVerified || !key || !addressInputRef.current) return;
    let cancelled = false;
    let cleanup = () => {};
    loadGooglePlaces(key)
      .then((google) => {
        if (cancelled || !addressInputRef.current) return;
        const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current, {
          componentRestrictions: { country: ["gb"] },
          fields: ["place_id", "formatted_address", "name", "geometry"],
          types: ["address"],
        });
        const listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          selectedPlaceRef.current = place;
          setPlaceId(place.place_id || null);
          setAddress(place.formatted_address || place.name || "");
        });
        cleanup = () => listener.remove();
      })
      .catch((error) => console.warn("Places failed to load (street booking):", error));
    return () => { cancelled = true; cleanup(); };
  }, [pinVerified, success]);

  const pricing = useMemo(() => {
    const lines = bins.filter((bin) => bin.type).map((bin, index) => {
      const plan = PLANS.find((item) => item.id === bin.planId) || PLANS[0];
      const count = Math.max(1, Number(bin.count) || 1);
      return {
        idx: index,
        type: bin.type,
        count,
        planId: plan.id,
        sizeLitres: isLargeCommercialPlan(bin.planId) ? bin.sizeLitres : null,
        planLabel: plan.label +
          (isLargeCommercialPlan(bin.planId) && bin.sizeLitres ? ` — ${bin.sizeLitres}L` : ""),
        unitPrice: plan.price,
        baseUnit: plan.price,
        discounted: false,
        lineTotal: Math.round(plan.price * count * 100) / 100,
      };
    });
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    return { lines, subtotal: total, total };
  }, [bins]);

  useEffect(() => {
    const selected = bins.filter(bin => bin.type).map(bin => ({type:bin.type}));
    const postcode = address.toUpperCase().match(/\bBT\d{1,2}[A-Z0-9]?\s*\d[A-Z]{2}\b/)?.[0];
    if (!postcode || !selected.length) {
      setBinDayStatus({state:"idle",results:[]});
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBinDayStatus({state:"loading",results:[]});
      try {
        const response = await fetch("/api/booking-schedule", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({address,postcode,bins:selected,staffPin}),
          signal:controller.signal
        });
        const data = await response.json();
        if (!controller.signal.aborted) setBinDayStatus({
          state:response.ok && data?.matched ? "matched" : "manual",
          results:Array.isArray(data?.results)?data.results:[],
          reason:data?.reason || null
        });
      } catch (error) {
        if (!controller.signal.aborted) setBinDayStatus({state:"error",results:[]});
      }
    },450);
    return () => {clearTimeout(timer);controller.abort();};
  },[address,bins,staffPin]);

  const formatBinDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return String(value || "");
    const date = new Date(`${value}T12:00:00Z`);
    return new Intl.DateTimeFormat("en-GB", {weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(date);
  };

  const updateBin = (index, field, value) => {
    setBins((current) => current.map((bin, binIndex) => {
      if (binIndex !== index) return bin;
      const updated = {
        ...bin,
        [field]: field === "count" ? Math.max(1, parseInt(value || "1", 10)) :
          field === "sizeLitres" ? (value ? Number(value) : null) : value,
      };
      if (field === "planId" && !isLargeCommercialPlan(value)) updated.sizeLitres = null;
      return updated;
    }));
  };

  const reset = () => {
    setBins([{ ...DEFAULT_BIN }]);
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setPlaceId(null);
    setTermsConfirmed(false);
    setTermsAccepted(false);
    setSuccess(false);
    selectedPlaceRef.current = null;
  };

  const verifyPin = async (event) => {
    event.preventDefault();
    setCheckingPin(true);
    setPinError("");
    try {
      const response = await fetch("/.netlify/functions/sendStreetBookingEmailV2", {
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"verify-pin",staffPin})
      });
      if (!response.ok) throw new Error("Incorrect PIN. Please try again.");
      setPinVerified(true);
    } catch (error) {
      setPinError(error.message || "Unable to verify PIN");
    } finally {
      setCheckingPin(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (bins.some((bin) => !hasRequiredBinSize(bin))) {
      alert("Please select 660L or 1100L for each large commercial bin.");
      return;
    }
    if (!name.trim() || !email.trim() || !phone.trim() || !address.trim() || bins.some((bin) => !bin.type)) {
      alert("Please complete all fields before submitting.");
      return;
    }
    if (!termsConfirmed || !termsAccepted) {
      alert("Please scroll through and confirm the Terms of Service.");
      return;
    }

    setSubmitting(true);
    try {
      const recaptchaAction = "street_booking_submit";
      const recaptchaToken = await getRecaptchaToken(recaptchaAction);
      if (!recaptchaToken) throw new Error("Anti-bot check not ready. Please try again.");

      const loc = selectedPlaceRef.current?.geometry?.location;
      const response = await fetch("/.netlify/functions/sendStreetBookingEmailV2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: createFriendlyBookingReference(),
          submittedAt: new Date().toISOString(),
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: address.trim(),
          bins,
          pricing,
          placeId,
          lat: loc ? loc.lat() : null,
          lng: loc ? loc.lng() : null,
          source: "street-signup",
          bookingScheduleSnapshot: (() => {
            const postcode = address.toUpperCase().match(/\\bBT\\d{1,2}[A-Z0-9]?\\s*\\d[A-Z]{2}\\b/)?.[0];
            if (!postcode || binDayStatus.state !== "matched" || binDayStatus.results.length !== bins.filter(bin => bin.type).length) return null;
            return { version: 1, postcode, matched: true,
              results: binDayStatus.results.map((result, index) => ({
                type: bins.filter(bin => bin.type)[index].type,
                automatic: result?.automatic === true,
                assignedCleanDate: result?.assignedCleanDate || null,
              })) };
          })(),
          staffPin,
          cleanCompletedToday: false,
          termsAccepted: true,
          termsVersion: TERMS_VERSION,
          termsAcceptanceText: `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION})`,
          termsTimestamp: new Date().toISOString(),
          recaptchaToken,
          recaptchaAction,
        }),
      });

      if (!response.ok) throw new Error(await response.text());
      // Score only after the street-signup booking has been accepted.
      const arcadeSubmissionId = window.crypto?.randomUUID?.()
        || "street-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      window.n64Score?.awardBooking(arcadeSubmissionId, bins);
      const booked = await response.json().catch(() => ({}));
      window.n64Score?.offerEntry(booked.arcadeBookingProof);
      setSuccess(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      console.error(error);
      alert(error?.message || "Unable to complete street signup.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="n64-street-booking min-h-screen bg-black text-white px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <a href="/" className="inline-block" aria-label="Ni Bin Guy home">
            <img src="/logo.webp" alt="Ni Bin Guy" className="w-44 sm:w-52 mx-auto" />
          </a>
          <p className="mt-4 text-yellow-400 font-black uppercase tracking-[0.16em] text-sm">Street Signup</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-black uppercase">Book today's clean. Signed up today.</h1>
          <p className="mt-3 text-gray-300">Use this page for customers who sign up while we are already on the street. Today's clean is booked without the standard same-day cutoff. Bookings are sent through the same Squeegee system as online bookings. Today's initial clean can be marked completed manually.</p>
        </div>

        <div className="bg-white text-black rounded-2xl shadow-2xl overflow-hidden">
          {!pinVerified ? (
            <form onSubmit={verifyPin} className="p-7 sm:p-10 space-y-4">
              <h2 className="text-xl font-black">Staff access PIN</h2>
              <p className="text-sm text-gray-600">Enter the Street Signup PIN to access the booking form.</p>
              <input type="password" inputMode="numeric" autoComplete="off"
                pattern="[0-9]{4,12}" minLength={4} maxLength={12}
                required aria-label="Street Signup PIN" value={staffPin}
                onChange={(event) => setStaffPin(event.target.value)}
                className="w-full border border-gray-500 rounded-lg px-4 py-3" />
              {pinError && <p role="alert" className="text-red-700 text-sm">{pinError}</p>}
              <button type="submit" disabled={checkingPin}
                className="w-full bg-black text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50">
                {checkingPin ? "Checking…" : "Unlock Street Signup"}
              </button>
            </form>
          ) : success ? (
            <div className="p-7 sm:p-10 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-green-500 flex items-center justify-center text-3xl font-black">✓</div>
              <h2 className="mt-5 text-3xl font-black">Signup complete</h2>
              <p className="mt-3 text-gray-600">The booking confirmation email and Terms & Conditions Acceptance Certificate have been triggered. No quote will be sent.</p>
              <button type="button" onClick={reset} className="mt-6 bg-black hover:bg-neutral-800 text-white font-bold py-3 px-6 rounded-xl w-full">Add another street customer</button>
            </div>
          ) : (
            <form onSubmit={submit} className="p-5 sm:p-7 space-y-4">
              <div className="rounded-xl bg-yellow-300 border border-yellow-400 p-4 text-sm font-semibold">This is a street signup booking. The customer is signed up immediately and no quote is required.</div>

              <input type="text" placeholder="Customer Name" value={name} onChange={(event) => setName(event.target.value)} className="w-full border border-gray-500 rounded-lg px-4 py-3" />

              {bins.map((bin, index) => (
                <div key={index} className="space-y-2 border-b border-gray-200 pb-4">
                  <div className="flex gap-3">
                    <select value={bin.type} onChange={(event) => updateBin(index, "type", event.target.value)} className="w-2/3 border border-gray-500 rounded-lg px-4 py-3">
                      <option value="">Select Bin</option>
                      <option value="Black Bin">Black</option>
                      <option value="Brown Bin">Brown</option>
                      <option value="Green Bin">Green</option>
                      <option value="Blue Bin">Blue</option>
                    </select>
                    <input type="number" min="1" value={bin.count} onChange={(event) => updateBin(index, "count", event.target.value)} className="w-1/3 border border-gray-500 rounded-lg px-4 py-3" />
                  </div>
                  <select value={bin.planId} onChange={(event) => updateBin(index, "planId", event.target.value)} className="w-full border border-gray-500 rounded-lg px-4 py-3">
                    {PLANS.map((plan) => <option key={plan.id} value={plan.id}>{plan.label} (£{money(plan.price)})</option>)}
                  </select>
                  {isLargeCommercialPlan(bin.planId) && (
                    <div className="space-y-1">
                      <label htmlFor={`street-large-bin-size-${index}`} className="block text-sm font-bold text-gray-800">
                        Commercial bin size (required)
                      </label>
                      <select
                        id={`street-large-bin-size-${index}`}
                        value={bin.sizeLitres ?? ""}
                        onChange={(event) => updateBin(index, "sizeLitres", event.target.value)}
                        required
                        aria-required="true"
                        className="w-full border border-gray-500 rounded-lg px-4 py-3"
                      >
                        <option value="">Select your bin size</option>
                        <option value="660">660 litres (660L)</option>
                        <option value="1100">1100 litres (1100L)</option>
                      </select>
                    </div>
                  )}
                </div>
              ))}

              <div className="flex items-center justify-between gap-4">
                <button type="button" onClick={() => setBins((current) => [...current, { ...DEFAULT_BIN }])} className="text-sm text-green-700 font-bold">+ Add Another Bin</button>
                {bins.length > 1 && <button type="button" onClick={() => setBins((current) => current.slice(0, -1))} className="text-sm text-red-600 font-bold">− Remove Last Bin</button>}
              </div>

              <input ref={addressInputRef} type="text" placeholder="Full Address" value={address} onChange={(event) => { setAddress(event.target.value); setPlaceId(null); selectedPlaceRef.current = null; }} className="w-full border border-gray-500 rounded-lg px-4 py-3" autoComplete="off" />
              <div className={`border p-4 sm:p-5 ${binDayStatus.state === "matched" ? "border-green-500 bg-green-50 text-green-900" : "border-amber-400 bg-amber-50 text-amber-950"}`} aria-live="polite">
                {binDayStatus.state === "matched" ? (
                  <>
                    <p className="text-lg font-bold">✓ Great! We have space, your regular booking will be confirmed for the following date:</p>
                    <div className="mt-3 space-y-2">
                      {binDayStatus.results.map((item, index) => (
                        <p key={index} className="text-base sm:text-lg"><strong>{item.bin}:</strong> {item.assignedCleanDate ? formatBinDate(item.assignedCleanDate) : "Date requires review"}</p>
                      ))}
                    </div>
                    <p className="mt-3 text-sm sm:text-base">Your regular service will continue on the same 4-week cycle.</p>
                    <p className="mt-2 text-sm font-semibold">Street Signup: today's clean can be marked complete manually in Squeegee.</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-bold">{binDayStatus.state === "loading" ? "Checking your bin collection day…" : "Bin collection day check"}</p>
                    {binDayStatus.state === "idle" && <p className="mt-2 text-sm">Select a bin and choose a full address including its BT postcode.</p>}
                    {(binDayStatus.state === "manual" || binDayStatus.state === "error") && <p className="mt-2 text-sm font-semibold">We couldn't confirm a regular cleaning date automatically. Please check the address and collection day before creating Squeegee jobs.</p>}
                  </>
                )}
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="font-bold">Booking price</div>
                <div className="mt-3 space-y-2 text-sm">
                  {pricing.lines.length ? pricing.lines.map((line) => (
                    <div key={line.idx} className="flex justify-between gap-4">
                      <span>{line.count}× {line.type.replace(" Bin", "")} — {line.planLabel}</span>
                      <strong>£{money(line.lineTotal)}</strong>
                    </div>
                  )) : <span className="text-gray-500">Select a bin to see pricing.</span>}
                  <div className="pt-2 border-t border-gray-300 flex justify-between text-base"><strong>Total</strong><strong>£{money(pricing.total)}</strong></div>
                </div>
              </div>

              <input type="tel" placeholder="Contact Number" value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full border border-gray-500 rounded-lg px-4 py-3" />
              <input type="email" placeholder="Email Address" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full border border-gray-500 rounded-lg px-4 py-3" />

              <div className="rounded-xl border border-gray-400 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-gray-700">Customer must view and agree to the <button type="button" onClick={() => setTermsOpen(true)} className="underline font-bold">Terms of Service</button>.</p>
                  <span className="text-[10px] text-gray-500">v{TERMS_VERSION}</span>
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={termsAccepted} disabled={!termsConfirmed} onChange={(event) => setTermsAccepted(event.target.checked)} />
                  <span>I’ve read and agree to the Terms of Service.{!termsConfirmed && <span className="block text-xs text-gray-500">Scroll to the bottom of the Terms and select Confirm & Agree to unlock this.</span>}</span>
                </label>
              </div>

              <button type="submit" disabled={submitting || !termsConfirmed || !termsAccepted} className="w-full bg-green-500 hover:bg-green-600 text-black font-black uppercase py-4 px-6 rounded-xl disabled:opacity-50">{submitting ? "Completing signup…" : "Complete Street Signup"}</button>
            </form>
          )}
        </div>
      </div>

      {termsOpen && (
        <TermsModal
          open={termsOpen}
          onClose={() => setTermsOpen(false)}
          onConfirm={() => {
            setTermsConfirmed(true);
            setTermsAccepted(true);
            setTermsOpen(false);
          }}
        />
      )}
    </div>
  );
}