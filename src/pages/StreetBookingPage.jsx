import React, { useEffect, useMemo, useRef, useState } from "react";

const TERMS_VERSION = "July 2026";
const TERMS_TITLE = "Ni Bin Guy – Terms of Service";
const TERMS_BODY = `Regular 4-weekly plans are based on a 13-clean minimum term, which is approximately 12 months, unless agreed otherwise.

One-off cleans have no minimum term and may be cancelled up to 24 hours before the scheduled clean day without charge.

Bins must be left out or made accessible on the scheduled cleaning day and must remain available until 8pm.

If your bin is not available when we attend, or access is blocked, the clean may still be charged.

If we are unable to attend on the scheduled day, we will notify you and rearrange the clean as soon as reasonably possible.

A 4-weekly plan may be cancelled any time up to 24 hours before the second scheduled clean. If cancelled before the second clean, the first clean will be charged at the standard one-off clean price, and any difference between the 4-weekly price and one-off price will become payable.

After the second clean, the 4-weekly plan continues for the full 13-clean minimum term.

If the customer cancels before the end of the 13-clean minimum term, they will remain liable for the outstanding balance for the remaining cleans within the 12-month minimum term.

After the 13-clean minimum term has been completed, the plan continues on a rolling basis and may be cancelled by giving at least 30 days’ notice.

One-off cleans containing dog faeces, cat litter, animal bedding, or other animal faeces/waste will incur a £5 surcharge per affected bin.

We may refuse to clean bins containing excessive animal waste, hazardous waste, sharp items, medical waste, chemicals, paint, oil, rubble, hot ashes, or anything unsafe.

Bins are cleaned inside and outside where safe using pressurised water and detergent. Some stains, ingrained smells, paint, tar, or long-term residue may take multiple visits or may not fully remove.

Payment is due within 7 days unless agreed otherwise. Accepted methods are Direct Debit, Bank Transfer, and Card. No cash.

Cancelling a Direct Debit does not cancel your service or contract. Cancellation must be requested directly with Ni Bin Guy.

Overdue accounts may result in service being stopped and may be referred for recovery.

Please keep your contact details, address, and payment details up to date, and make sure access is safe on cleaning day.

We may place a small sticker or service tag on your bin. Discounts are discretionary and may be withdrawn or changed.

You consent to us storing your details and contacting you about your booking, schedule, payment, and service.

Text reminders are a courtesy only. You remain responsible for knowing your scheduled clean date.`;

const PLANS = [
  { id: "domestic_4w", label: "4 Weekly", price: 5 },
  { id: "domestic_oneoff", label: "One-off", price: 15 },
  { id: "comm_lt360_4w", label: "Commercial <360L 4 Weekly", price: 5 },
  { id: "comm_lt360_oneoff", label: "Commercial <360L One-Off", price: 15 },
  { id: "comm_gt660_4w", label: "Commercial >660L 4 Weekly", price: 12.5 },
  { id: "comm_gt660_oneoff", label: "Commercial >660L One-Off", price: 35 },
];

const DEFAULT_BIN = { type: "", count: 1, planId: "domestic_4w" };

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
    setScrolledToEnd(false);
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setScrolledToEnd(true);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 p-3 sm:p-6 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white text-black w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold">{TERMS_TITLE} <span className="text-xs font-normal text-gray-500">(v{TERMS_VERSION})</span></h2>
          <button type="button" onClick={onClose} className="text-2xl text-gray-500 hover:text-black" aria-label="Close Terms">&times;</button>
        </div>
        <div ref={scrollRef} className="px-6 py-4 max-h-[65dvh] overflow-y-auto whitespace-pre-line text-sm leading-6">{TERMS_BODY}</div>
        <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-600">Scroll to the end to enable agreement.</span>
          <button type="button" onClick={onConfirm} disabled={!scrolledToEnd} className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-black font-semibold disabled:opacity-50">Confirm &amp; Agree</button>
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
  const [termsViewed, setTermsViewed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const addressInputRef = useRef(null);
  const selectedPlaceRef = useRef(null);

  useEffect(() => {
    document.title = "Street Signup | Ni Bin Guy";
    const key = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
    if (!key || !addressInputRef.current) return;
    let cleanup = () => {};
    loadGooglePlaces(key)
      .then((google) => {
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
    return () => cleanup();
  }, []);

  const pricing = useMemo(() => {
    const lines = bins.filter((bin) => bin.type).map((bin, index) => {
      const plan = PLANS.find((item) => item.id === bin.planId) || PLANS[0];
      const count = Math.max(1, Number(bin.count) || 1);
      return {
        idx: index,
        type: bin.type,
        count,
        planId: plan.id,
        planLabel: plan.label,
        unitPrice: plan.price,
        baseUnit: plan.price,
        discounted: false,
        lineTotal: Math.round(plan.price * count * 100) / 100,
      };
    });
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    return { lines, subtotal: total, total };
  }, [bins]);

  const updateBin = (index, field, value) => {
    setBins((current) => current.map((bin, binIndex) => binIndex === index ? { ...bin, [field]: field === "count" ? Math.max(1, parseInt(value || "1", 10)) : value } : bin));
  };

  const reset = () => {
    setBins([{ ...DEFAULT_BIN }]);
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setPlaceId(null);
    setTermsViewed(false);
    setTermsAccepted(false);
    setSuccess(false);
    selectedPlaceRef.current = null;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || !address.trim() || bins.some((bin) => !bin.type)) {
      alert("Please complete all fields before submitting.");
      return;
    }
    if (!termsAccepted) {
      alert("Please view and agree to the Terms of Service.");
      return;
    }

    setSubmitting(true);
    try {
      const recaptchaAction = "street_booking_submit";
      const recaptchaToken = await getRecaptchaToken(recaptchaAction);
      if (!recaptchaToken) throw new Error("Anti-bot check not ready. Please try again.");

      const loc = selectedPlaceRef.current?.geometry?.location;
      const response = await fetch("/.netlify/functions/sendStreetBookingEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          cleanCompletedToday: true,
          termsAccepted: true,
          termsVersion: TERMS_VERSION,
          termsAcceptanceText: `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION}).`,
          termsTimestamp: new Date().toISOString(),
          recaptchaToken,
          recaptchaAction,
        }),
      });

      if (!response.ok) throw new Error(await response.text());
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
    <div className="min-h-screen bg-black text-white px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <a href="/" className="inline-block" aria-label="Ni Bin Guy home">
            <img src="/logo.webp" alt="Ni Bin Guy" className="w-44 sm:w-52 mx-auto" />
          </a>
          <p className="mt-4 text-yellow-400 font-black uppercase tracking-[0.16em] text-sm">Street Signup</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-black uppercase">Cleaned today. Signed up today.</h1>
          <p className="mt-3 text-gray-300">Use this page for customers who sign up while we are already on the street. Their clean is completed there and then, so no quote is sent.</p>
        </div>

        <div className="bg-white text-black rounded-2xl shadow-2xl overflow-hidden">
          {success ? (
            <div className="p-7 sm:p-10 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-green-500 flex items-center justify-center text-3xl font-black">✓</div>
              <h2 className="mt-5 text-3xl font-black">Signup complete</h2>
              <p className="mt-3 text-gray-600">The customer confirmation email has been triggered and records that today’s clean was completed. No quote will be sent.</p>
              <button type="button" onClick={reset} className="mt-6 bg-black hover:bg-neutral-800 text-white font-bold py-3 px-6 rounded-xl w-full">Add another street customer</button>
            </div>
          ) : (
            <form onSubmit={submit} className="p-5 sm:p-7 space-y-4">
              <div className="rounded-xl bg-yellow-300 border border-yellow-400 p-4 text-sm font-semibold">This form records the clean as <strong>completed today</strong>. It is not a quote request.</div>

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
                </div>
              ))}

              <div className="flex items-center justify-between gap-4">
                <button type="button" onClick={() => setBins((current) => [...current, { ...DEFAULT_BIN }])} className="text-sm text-green-700 font-bold">+ Add Another Bin</button>
                {bins.length > 1 && <button type="button" onClick={() => setBins((current) => current.slice(0, -1))} className="text-sm text-red-600 font-bold">− Remove Last Bin</button>}
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="font-bold">Today’s clean / plan price</div>
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

              <input ref={addressInputRef} type="text" placeholder="Full Address" value={address} onChange={(event) => { setAddress(event.target.value); setPlaceId(null); selectedPlaceRef.current = null; }} className="w-full border border-gray-500 rounded-lg px-4 py-3" autoComplete="off" />
              <input type="tel" placeholder="Contact Number" value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full border border-gray-500 rounded-lg px-4 py-3" />
              <input type="email" placeholder="Email Address" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full border border-gray-500 rounded-lg px-4 py-3" />

              <div className="rounded-xl border border-gray-400 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-gray-700">Customer must view and agree to the <button type="button" onClick={() => { setTermsOpen(true); setTermsViewed(true); }} className="underline font-bold">Terms of Service</button>.</p>
                  <span className="text-[10px] text-gray-500">v{TERMS_VERSION}</span>
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={termsAccepted} disabled={!termsViewed} onChange={(event) => setTermsAccepted(event.target.checked)} />
                  <span>I’ve read and agree to the Terms of Service.{!termsViewed && <span className="block text-xs text-gray-500">Open the Terms first to enable this.</span>}</span>
                </label>
              </div>

              <button type="submit" disabled={submitting || !termsAccepted} className="w-full bg-green-500 hover:bg-green-600 text-black font-black uppercase py-4 px-6 rounded-xl disabled:opacity-50">{submitting ? "Completing signup…" : "Complete Street Signup"}</button>
            </form>
          )}
        </div>
      </div>

      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} onConfirm={() => { setTermsAccepted(true); setTermsOpen(false); }} />
    </div>
  );
}
