import React, { useEffect, useRef, useState } from "react";
import { loadGooglePlaces } from "../useGooglePlaces.js";

// The council list is an independent postcode fallback if Google Places cannot
// serve the preview domain. No address is persisted by this component.
export function findNiPostcode(value) {
  const match = String(value || "").toUpperCase().match(/\bBT\d{1,2}[A-Z0-9]?\s*\d[A-Z]{2}\b/);
  if (!match) return "";
  const compact = match[0].replace(/\s+/g, "");
  return compact.slice(0, -3) + " " + compact.slice(-3);
}

// Google autocomplete text is a suggestion, NOT a complete postal address.
// The selected Place Details record is the authority for the BT postcode.
function completeAddress(address, postcode) {
  const base = String(address || "").trim().replace(/\s+/g, " ");
  if (!postcode || findNiPostcode(base)) return base;
  const shortened = base.replace(/,\s*(?:UK|United Kingdom)\s*$/i, "").replace(/,\s*$/, "");
  return shortened + ", " + postcode + (shortened !== base ? ", UK" : "");
}

function postcodeInComponents(components) {
  if (!Array.isArray(components)) return "";
  const postal = components.find((component) => Array.isArray(component?.types) && component.types.includes("postal_code"));
  return findNiPostcode(postal?.longText || postal?.shortText || postal?.long_name || postal?.short_name);
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
  const [addressNotice, setAddressNotice] = useState({ status: "idle", message: "" });

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
    setAddressNotice({ status: "idle", message: "" });
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

    // Populate the field immediately, but never treat a postcode-free Google
    // suggestion as a verified postal address for cleaning-date calculation.
    onPlace({
      formatted_address: item.label,
      place_id: item.source === "council" ? null : item.id,
    });
    if (item.source === "council") {
      setAddressNotice({ status: "confirmed", message: "Postcode: " + findNiPostcode(item.label) });
      return;
    }

    setAddressNotice({ status: "loading", message: "Checking the complete address and BT postcode…" });

    let candidate = null;
    // All Google prediction sources (server, new Maps JS and legacy Maps JS)
    // can be resolved by the same protected server-side Place Details endpoint.
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(
        "/.netlify/functions/bookingAddressDetails?placeId=" + encodeURIComponent(item.id),
        { method: "GET", signal: controller.signal, cache: "no-store" }
      );
      if (response.ok) candidate = await response.json();
    } catch (_) {
      // If server details fail, try Google's browser API below.
    } finally {
      window.clearTimeout(timer);
    }
    if (selectionRef.current !== sequence) return;

    // Google can occasionally return a street or area with no postal code.
    // On those results, make one bounded attempt using the browser API.
    const returnedPostcode = findNiPostcode(candidate?.postcode || candidate?.formatted_address);
    if (!returnedPostcode && item.source === "google-new" && item.prediction?.toPlace) {
      try {
        const detail = item.prediction.toPlace();
        await Promise.race([
          detail.fetchFields({ fields: ["id", "formattedAddress", "location", "addressComponents"] }),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("Google details timeout")), 3500)),
        ]);
        if (selectionRef.current !== sequence) return;
        const postal = postcodeInComponents(detail.addressComponents) || findNiPostcode(detail.formattedAddress);
        if (postal || !candidate) {
          candidate = {
            place_id: detail.id || item.id,
            formatted_address: detail.formattedAddress || item.label,
            postcode: postal,
            location: detail.location,
          };
        }
      } catch (_) {
        // Manual postcode entry remains possible.
      }
    }
    if (!findNiPostcode(candidate?.postcode || candidate?.formatted_address) &&
        item.source === "google-legacy" && placesRef.current?.PlacesService) {
      try {
        const places = placesRef.current;
        if (!detailsServiceRef.current) {
          detailsServiceRef.current = new places.PlacesService(document.createElement("div"));
        }
        const detail = await Promise.race([
          new Promise((resolve, reject) => {
            detailsServiceRef.current.getDetails(
              { placeId: item.id, fields: ["place_id", "formatted_address", "geometry", "address_components"] },
              (result, resultStatus) => {
                if (resultStatus === places.PlacesServiceStatus.OK && result) resolve(result);
                else reject(new Error("Place details not found"));
              }
            );
          }),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("Google details timeout")), 3500)),
        ]);
        if (selectionRef.current !== sequence) return;
        const postal = postcodeInComponents(detail.address_components) || findNiPostcode(detail.formatted_address);
        if (postal || !candidate) {
          candidate = {
            place_id: detail.place_id || item.id,
            formatted_address: detail.formatted_address || item.label,
            postcode: postal,
            geometry: detail.geometry,
          };
        }
      } catch (_) {
        // The user can enter the postcode without relying on Google.
      }
    }
    if (selectionRef.current !== sequence) return;

    const postal = findNiPostcode(candidate?.postcode)
      || postcodeInComponents(candidate?.addressComponents || candidate?.address_components)
      || findNiPostcode(candidate?.formatted_address)
      || findNiPostcode(item.label);
    const address = completeAddress(candidate?.formatted_address || item.label, postal);
    const loc = candidate?.geometry?.location || candidate?.location;
    const latitude = typeof loc?.lat === "function" ? loc.lat() : Number(loc?.latitude);
    const longitude = typeof loc?.lng === "function" ? loc.lng() : Number(loc?.longitude);

    onPlace({
      place_id: candidate?.place_id || item.id,
      formatted_address: address,
      postcode: postal,
      geometry: Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { location: { lat: () => latitude, lng: () => longitude } }
        : undefined,
    });
    setAddressNotice(postal
      ? { status: "confirmed", message: "Postcode confirmed: " + postal }
      : {
          status: "missing",
          message: "Google hasn't provided the postcode for this address. Add the full BT postcode before booking so we can calculate the correct cleaning date.",
        });
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
      {addressNotice.message && (
        <p
          className={"mt-2 text-xs font-semibold " + (
            addressNotice.status === "missing" ? "text-amber-900" :
            addressNotice.status === "confirmed" ? "text-green-700" : "text-gray-600"
          )}
          role="status"
          aria-live="polite"
        >
          {addressNotice.message}
        </p>
      )}
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
