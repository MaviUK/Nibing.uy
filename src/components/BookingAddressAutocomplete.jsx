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

    setStatus("searching");
    setActiveIndex(-1);
    const controller = new AbortController();
    const isCurrent = () => requestRef.current === requestNumber;
    const timer = window.setTimeout(async () => {
      // Ards & North Down council can return actual properties for full BT
      // postcodes, including when Google browser-key restrictions apply.
      const postcode = findNiPostcode(query);
      if (postcode) {
        try {
          const response = await fetch(
            "/.netlify/functions/binAddresses?postcode=" + encodeURIComponent(postcode),
            { signal: controller.signal }
          );
          if (response.ok) {
            const matches = councilSuggestions(await response.json(), postcode);
            if (matches.length) {
              if (isCurrent()) {
                setSuggestions(matches);
                setStatus("ready");
              }
              return;
            }
          }
        } catch (_) {
          // A council outage must not block the normal Google lookup.
        }
      }
      if (!isCurrent()) return;
      if (provider === "loading") {
        setStatus("loading");
        return;
      }
      if (provider !== "ready" || !placesRef.current) {
        setStatus("unavailable");
        return;
      }

      const places = placesRef.current;
      if (places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
        try {
          const result = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            includedRegionCodes: ["gb"],
          });
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
          }).filter((item) => item?.label).slice(0, 6);
          setSuggestions(matches);
          setStatus(matches.length ? "ready" : "empty");
          return;
        } catch (_) {
          // Some existing Google projects only support the legacy Places API.
        }
      }

      if (!places.AutocompleteService) {
        if (isCurrent()) setStatus("unavailable");
        return;
      }

      try {
        if (!legacyAutocompleteRef.current) {
          legacyAutocompleteRef.current = new places.AutocompleteService();
        }
        legacyAutocompleteRef.current.getPlacePredictions({
          input: query,
          componentRestrictions: { country: "gb" },
          types: ["address"],
        }, (predictions, responseStatus) => {
          if (!isCurrent()) return;
          if (responseStatus === places.PlacesServiceStatus.OK && Array.isArray(predictions)) {
            const matches = predictions.slice(0, 6).map((item) => ({
              id: item.place_id,
              label: item.description,
              source: "google-legacy",
            }));
            setSuggestions(matches);
            setStatus(matches.length ? "ready" : "empty");
          } else {
            setSuggestions([]);
            setStatus(responseStatus === places.PlacesServiceStatus.ZERO_RESULTS ? "empty" : "unavailable");
          }
        });
      } catch (_) {
        if (isCurrent()) setStatus("unavailable");
      }
    }, 260);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
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
    if (item.source === "council") return;
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
