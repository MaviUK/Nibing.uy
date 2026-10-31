import React, { useMemo, useState } from "react";

function normalizePostcode(raw) {
  const s = String(raw || "").toUpperCase().trim().replace(/\s+/g, "");
  // Insert a space before the last 3 characters if possible
  if (s.length > 3) return `${s.slice(0, -3)} ${s.slice(-3)}`;
  return s;
}

export default function BinCheckerModal({ onClose }) {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);

  // NEW: addresses are objects: { uprn, addressText }
  const [addresses, setAddresses] = useState([]);
  const [selectedUprn, setSelectedUprn] = useState("");
  const [selectedAddressText, setSelectedAddressText] = useState("");

  // NEW: council calendar html snippet
  const [calendarHtml, setCalendarHtml] = useState("");
  const [error, setError] = useState("");

  const canFetchSchedule = useMemo(() => !!selectedUprn, [selectedUprn]);

  async function findAddresses() {
    setError("");
    setCalendarHtml("");
    setSelectedUprn("");
    setSelectedAddressText("");
    setAddresses([]);

    const pc = normalizePostcode(postcode);
    if (!pc || pc.length < 5) {
      setError("Enter a valid postcode.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/.netlify/functions/binAddresses?postcode=${encodeURIComponent(pc)}`
      );

      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        setError("Lookup failed. Try again.");
        return;
      }

      // Expected shape: { data: { addresses: [{ uprn, addressText }] } }
      let list = data?.data?.addresses;

      // Fallbacks just in case:
      if (!Array.isArray(list) && Array.isArray(data?.addresses)) list = data.addresses;
      if (!Array.isArray(list) && data?.addresses && typeof data.addresses === "object")
        list = Object.values(data.addresses);

      // Normalize to [{ uprn, addressText }]
      const normalized = (list || [])
        .map((a) => {
          if (!a) return null;

          // If already object
          if (typeof a === "object" && (a.uprn || a.addressText)) {
            const uprn = String(a.uprn || "").trim();
            const addressText = String(a.addressText || a.address || "").trim();
            if (!uprn || !addressText) return null;
            return { uprn, addressText };
          }

          // If string only (older format), can't fetch calendar without UPRN
          // so we skip those
          return null;
        })
        .filter(Boolean);

      if (!normalized.length) {
        setError("No addresses found for that postcode.");
        return;
      }

      setAddresses(normalized);
    } catch (e) {
      setError("Lookup failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchSchedule() {
  setError("");
  setCalendarHtml("");

  if (!selectedUprn) {
    setError("Pick your address first.");
    return;
  }

  setLoading(true);
  try {
    const res = await fetch(
      `/.netlify/functions/binCalendar?uprn=${encodeURIComponent(selectedUprn)}`
    );

    const data = await res.json().catch(() => null);

    if (!res.ok || !data) {
      setError("Couldn’t load schedule for that address.");
      return;
    }

    // 🔑 THIS IS THE IMPORTANT LINE
    const html = data.html || data.calendarHTML;

    if (!html) {
      setError("No schedule returned.");
      return;
    }

    // ✅ Store ONLY the HTML string
    setCalendarHtml(html);
    // Reward only after the council bin calendar has loaded successfully.
    window.n64Score?.awardAction("bin-checker");
  } catch (e) {
    setError("Couldn’t load schedule for that address.");
  } finally {
    setLoading(false);
  }
}


  return (
    <div className="p-6 space-y-4 relative">
      <button
  onClick={onClose}
  className="absolute top-3 right-4 text-gray-400 hover:text-gray-700 text-2xl z-50 bg-white rounded-full w-8 h-8 flex items-center justify-center shadow"
  aria-label="Close bin checker"
>
  ×
</button>



      <h2 id="bin-checker-title" className="text-2xl font-bold text-center">
        Bin Day Checker
      </h2>

      <p className="text-sm text-gray-600 text-center">
        Enter your postcode, pick your address, and we’ll show your next collection dates.
      </p>

      <input
        type="text"
        placeholder="e.g. BT20 5NF"
        value={postcode}
        onChange={(e) => setPostcode(e.target.value)}
        className="w-full border border-gray-500 rounded-lg px-4 py-2"
        autoComplete="postal-code"
      />

      <button
        type="button"
        onClick={findAddresses}
        disabled={loading}
        className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-lg w-full disabled:opacity-60"
      >
        {loading ? "Searching..." : "Find my address"}
      </button>

      {!!addresses.length && (
        <select
          value={selectedUprn}
          onChange={(e) => {
            const uprn = e.target.value;
            setSelectedUprn(uprn);

            const match = addresses.find((a) => a.uprn === uprn);
            setSelectedAddressText(match?.addressText || "");
            setCalendarHtml("");
            setError("");
          }}
          className="w-full border border-gray-500 rounded-lg px-4 py-2"
        >
          <option value="">Select your address...</option>
          {addresses.map((a) => (
            <option key={a.uprn} value={a.uprn}>
              {a.addressText}
            </option>
          ))}
        </select>
      )}

      {!!addresses.length && (
        <button
          type="button"
          onClick={fetchSchedule}
          disabled={loading || !canFetchSchedule}
          className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg w-full disabled:opacity-60"
        >
          {loading ? "Loading..." : "Show my bin days"}
        </button>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {calendarHtml && (
        <div className="border border-gray-200 bg-gray-50 rounded-lg p-4 space-y-2">
          <div className="text-sm font-semibold text-gray-800">
            Next collections {selectedAddressText ? `— ${selectedAddressText}` : ""}
          </div>

          {/* Council returns HTML. Render it directly. */}
         <div
  className="text-sm"
  dangerouslySetInnerHTML={{ __html: calendarHtml }}
/>
        </div>
      )}

      <p className="text-[11px] text-gray-500 text-center pt-1">
        If the checker can’t find your address, the council lookup may have changed — Contact us and we’ll fix it.
      </p>
    </div>
  );
}
