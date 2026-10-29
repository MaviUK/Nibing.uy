import React, { useEffect, useRef, useState } from "react";
import { loadGooglePlaces } from "../useGooglePlaces.js";

// The council list is an independent postcode fallback if Google Places cannot
// serve the preview domain. No address is persisted by this component.
function findNiPostcode(value) {
  const match = String(value || "").toUpperCase().match(/\bBT\d{1,2}[A-Z0-9]?\s*\d[A-Z]{2}\b/);
  if (!match) return "";
  const compact = match[0].replace(/\s+/g, "");
  return compact.slice(0, -3) + " " + compact.slice(-3);
}

function councilSuggestions(payload, postcode) {
  const raw = payload?.data?.addresses ?? payload?.addresses ?? [];
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
  const seen = new Set();
  return list.map((row) => {
    const label = String(row?.addressText || row?.address || row?.label || "").trim();
    if (!label) return null;
    const full = label.toUpperCase().replace(/\s+/g, "").includes(postcode.replace(/\s+/g, ""))
      ? label : label + ", " + postcode;
    if (seen.has(full.toLowerCase())) return null;
    seen.add(full.toLowerCase());
    return { id: String(row?.uprn || row?.UPRN || full), label: full, source: "council" };
  }).filter(Boolean).slice(0, 30);
}

export default function BookingAddressAutocomplete({ value, onChange, onPlace }) {
  const wrapperRef = useRef(null);
  const requestRef = useRef(0);
  const selectionRef = useRef(0);
  const placesRef = useRef(null);
  const legacyAutocompleteRef = useRef(null);
  const detailsServiceRef = useRef(null);

  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("loading");
  const [suggestions, setSuggestions] = useState([]);
  const [status, setStatus] = useState("idle");
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    let active = true;
    const apiKey = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setProvider("unavailable");
      return;
    }

    loadGooglePlaces(apiKey).then((google) => {
      if (!active) return;
      const places = google?.maps?.places;
      if (!places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions && !places?.AutocompleteService) {
        setProvider("unavailable");
        return;
      }
      placesRef.current = places;
      setProvider("ready");
    }).catch(() => {
      if (active) setProvider("unavailable");
    });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const closeOutside = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  useEffect(() => {
    const query = typed.trim();
    const requestNumber = ++requestRef.current;
    if (!open || query.length < 3) {
      setSuggestions([]);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let completed = false;
    const controller = new AbortController();
    const isCurrent = () => !cancelled && !completed && requestRef.current === requestNumber;
    const deliver = (items, state) => {
      if (!isCurrent()) return;
      completed = true;
      setSuggestions(items);
      setStatus(state);
    };

    // Every search has a finite deadline. Previously an unresolved Google
    // promise could leave "Searching for addresses..." visible indefinitely.
    const hardStop = window.setTimeout(() => {
      if (isCurrent()) {
        deliver([], "unavailable");
        controller.abort();
      }
    }, 10000);

    async function timedJson(url, ms) {
      const requestController = new AbortController();
      const abort = () => requestController.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      const timeout = window.setTimeout(abort, ms);
      try {
        const response = await fetch(url, {
          method: "GET",
          signal: requestController.signal,
          cache: "no-store",
        });
        if (!response.ok) return null;
        return await response.json();
      } finally {
        window.clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abort);
      }
    }

    function withDeadline(promise, ms) {
      let timer;
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = window.setTimeout(() => reject(new Error("Address lookup timeout")), ms);
        }),
      ]).finally(() => window.clearTimeout(timer));
    }

    async function run() {
      setStatus("searching");
      setSuggestions([]);
      setActiveIndex(-1);

      // 1. Council properties are often the most accurate result for full BT
      // postcodes, and don't depend on Google API key/referrer restrictions.
      const postcode = findNiPostcode(query);
      if (postcode) {
        try {
          const body = await timedJson(
            "/.netlify/functions/binAddresses?postcode=" + encodeURIComponent(postcode),
            3000
          );
          if (!isCurrent()) return;
          const matches = councilSuggestions(body, postcode);
          if (matches.length) {
            deliver(matches, "ready");
            return;
          }
        } catch (_) {
          if (!isCurrent()) return;
        }
      }

      // 2. Server-side Google Places uses the existing protected Netlify key.
      // It works even when maps.googleapis.com is blocked by the preview host.
      try {
        const body = await timedJson(
          "/.netlify/functions/bookingAddressSuggestions?q=" + encodeURIComponent(query),
          5300
        );
        if (!isCurrent()) return;
        if (Array.isArray(body?.addresses) && body.addresses.length) {
          deliver(body.addresses.slice(0, 8), "ready");
          return;
        }
      } catch (_) {
        if (!isCurrent()) return;
      }

      // 3. Keep the Google JavaScript API as a backup for browsers where it
      // works, but bound every Google promise/callback by a timeout.
      const places = provider === "ready" ? placesRef.current : null;
      if (!places) {
        deliver([], "unavailable");
        return;
      }

      if (places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
        try {
          const result = await withDeadline(
            places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: query,
              includedRegionCodes: ["gb"],
            }),
            2400
          );
          if (!isCurrent()) return;
          const matches = (result?.suggestions || []).map((item) => {
            const prediction = item?.placePrediction;
            if (!prediction?.placeId) return null;
            return {
              id: prediction.placeId,
              label: prediction.text?.toString() || "",
              source: "google-new",
              prediction,
            };
          }).filter((item) => item?.label).slice(0, 8);
          if (matches.length) {
            deliver(matches, "ready");
            return;
          }
        } catch (_) {
          if (!isCurrent()) return;
        }
      }

      if (places.AutocompleteService) {
        try {
          if (!legacyAutocompleteRef.current) {
            legacyAutocompleteRef.current = new places.AutocompleteService();
          }
          const predictions = await withDeadline(new Promise((resolve, reject) => {
            legacyAutocompleteRef.current.getPlacePredictions({
              input: query,
              componentRestrictions: { country: "gb" },
              types: ["address"],
            }, (list, responseStatus) => {
              if (responseStatus === places.PlacesServiceStatus.OK) resolve(list || []);
              else if (responseStatus === places.PlacesServiceStatus.ZERO_RESULTS) resolve([]);
              else reject(new Error("Google autocomplete not available"));
            });
          }), 2400);
          if (!isCurrent()) return;
          const matches = predictions.slice(0, 8).map((item) => ({
            id: item.place_id,
            label: item.description,
            source: "google-legacy",
          })).filter((item) => item.label);
          deliver(matches, matches.length ? "ready" : "empty");
          return;
        } catch (_) {
          if (!isCurrent()) return;
        }
      }
      deliver([], "unavailable");
    }

    const timer = window.setTimeout(() => { void run().catch(() => {
      deliver([], "unavailable");
    }); }, 280);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(hardStop);
    };
  }, [typed, open, provider]);

  function handleChange(event) {
    selectionRef.current += 1;
    const next = event.target.value;
    onChange(next);
    setTyped(next);
    setOpen(true);
  }

  async function chooseSuggestion(item) {
    const sequence = ++selectionRef.current;
    setOpen(false);
    setTyped("");
    setSuggestions([]);
    // Fill immediately, even if fetching Google place details takes time.
    onPlace({ formatted_address: item.label, place_id: item.source === "council" ? null : item.id });
    if (item.source === "council" || item.source === "google-server") return;
    try {
      let place;
      if (item.source === "google-new") {
        const details = item.prediction.toPlace();
        await details.fetchFields({ fields: ["id", "formattedAddress", "location"] });
        place = {
          place_id: details.id || item.id,
          formatted_address: details.formattedAddress || item.label,
          geometry: details.location ? { location: details.location } : undefined,
        };
      } else {
        const places = placesRef.current;
        if (!detailsServiceRef.current) {
          detailsServiceRef.current = new places.PlacesService(document.createElement("div"));
        }
        place = await new Promise((resolve, reject) => {
          detailsServiceRef.current.getDetails(
            { placeId: item.id, fields: ["place_id", "formatted_address", "geometry"] },
            (result, resultStatus) => {
              if (resultStatus === places.PlacesServiceStatus.OK && result) resolve(result);
              else reject(new Error("Place details unavailable"));
            }
          );
        });
      }
      if (selectionRef.current === sequence) onPlace(place);
    } catch (_) {
      // The selected display address is still valid for manual booking.
    }
  }

  function handleKeyDown(event) {
    if (!open || !suggestions.length) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      void chooseSuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && typed.trim().length >= 3;

  return (
    <div ref={wrapperRef} className="relative mt-4">
      <label className="sr-only" htmlFor="booking-address-input">Full address</label>
      <input
        id="booking-address-input"
        type="text"
        placeholder="Full Address"
        value={value}
        onChange={handleChange}
        onFocus={() => { setOpen(true); if (!typed && value?.trim()) setTyped(value); }}
        onKeyDown={handleKeyDown}
        className="w-full border border-gray-500 rounded-lg px-4 py-2"
        autoComplete="off"
        inputMode="text"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={showList}
        aria-controls={showList ? "booking-address-options" : undefined}
        aria-activedescendant={showList && activeIndex >= 0 ? "booking-address-option-" + activeIndex : undefined}
      />
      {showList && (
        <div
          id="booking-address-options"
          role="listbox"
          aria-label="Matching addresses"
          className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-52 overflow-y-auto border-4 border-[#26395f] bg-white text-[#26395f] shadow-[5px_6px_0_#8a9fbe]"
        >
          {suggestions.map((item, index) => (
            <button
              key={item.source + ":" + item.id}
              id={"booking-address-option-" + index}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={"block w-full border-0 border-b border-slate-200 bg-white px-3 py-3 text-left text-sm font-semibold text-[#26395f] hover:bg-amber-100 focus:bg-amber-100 " + (index === activeIndex ? "bg-amber-100" : "")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { void chooseSuggestion(item); }}
            >
              {item.label}
            </button>
          ))}
{suggestions.some((item) => item.source?.startsWith("google")) && (
            <p className="m-0 px-3 pb-2 pt-1 text-[11px] text-gray-500" translate="no" aria-label="Google Maps attribution">Google Maps</p>
          )}
                    {status !== "ready" && (
            <p className="m-0 px-3 py-3 text-sm" role="status" aria-live="polite">
              {status === "searching" || status === "loading"
                ? "Searching for addresses…"
                : status === "empty"
                  ? "No matches yet. Try a full BT postcode or continue typing your address."
                  : "Address suggestions are unavailable. Enter your full address manually or try a BT postcode."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
