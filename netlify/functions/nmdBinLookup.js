function normalizePostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 5 || compact.length > 7) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function normalizeBin(value) {
  const bin = String(value || "BLACK").toUpperCase();
  return ["BLACK", "BLUE", "BROWN"].includes(bin) ? bin : "BLACK";
}

function dateOnly(value) {
  const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function isFutureOrToday(value) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return value >= today;
}

function matchesBin(type, wanted) {
  const text = String(type || "").toUpperCase();
  if (wanted === "BLACK") return /BLACK|GENERAL|RESIDUAL/.test(text);
  if (wanted === "BLUE") return /BLUE|RECYCL/.test(text);
  return /BROWN|GARDEN|FOOD/.test(text);
}

async function jsonFetch(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "NI-Bin-Guy/1.0 (nibing.uy)",
    },
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    throw new Error(`Bin data service returned ${response.status}${data?.detail ? `: ${data.detail}` : ""}`);
  }
  return data;
}

async function lookupViaUkBinDay(postcode, wantedBin) {
  const compact = postcode.replace(/\s/g, "");
  const base = "https://ukbinday.co.uk/api/v1";

  const councilData = await jsonFetch(`${base}/council/${encodeURIComponent(compact)}`);
  const councilId = councilData?.council_id;
  const councilName = councilData?.council_name || "";
  if (!councilId || !/newry|mourne|down/i.test(councilName)) {
    return { matched: false, reason: "postcode_not_nmd", councilData };
  }

  const addressData = await jsonFetch(`${base}/addresses/${encodeURIComponent(compact)}`);
  const addresses = Array.isArray(addressData?.addresses) ? addressData.addresses : [];
  if (!addresses.length) return { matched: false, reason: "no_addresses", councilData };

  // NMD's own calendar lookup is postcode based. Use the first UPRN in the postcode
  // to access the same live council-backed schedule through the open UK Bin Day API.
  const address = addresses[0];
  const uprn = String(address?.uprn || "");
  if (!uprn) return { matched: false, reason: "no_uprn", councilData };

  const addressLabel = address?.address || address?.label || address?.formatted_address || "";
  const query = new URLSearchParams({ council: councilId, postcode: compact });
  if (addressLabel) query.set("address", addressLabel);
  const lookup = await jsonFetch(`${base}/lookup/${encodeURIComponent(uprn)}?${query.toString()}`);
  const collections = Array.isArray(lookup?.collections) ? lookup.collections : [];

  const allDates = collections
    .map(item => ({ date: dateOnly(item?.date), type: item?.type || "" }))
    .filter(item => item.date && isFutureOrToday(item.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const selected = [...new Set(allDates.filter(item => matchesBin(item.type, wantedBin)).map(item => item.date))].slice(0, 2);

  return {
    matched: selected.length >= 2,
    dates: selected,
    councilData,
    addressCount: addresses.length,
    sampleAddress: addressLabel,
    uprn,
    collections: allDates.slice(0, 12),
    cached: lookup?.cached ?? null,
    reason: selected.length >= 2 ? null : "selected_bin_dates_not_found",
  };
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const postcode = normalizePostcode(url.searchParams.get("postcode"));
    const bin = normalizeBin(url.searchParams.get("bin"));
    if (!postcode) {
      return new Response(JSON.stringify({ error: "Enter a valid Northern Ireland postcode." }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const result = await lookupViaUkBinDay(postcode, bin);
    return new Response(JSON.stringify({
      matched: result.matched,
      postcode,
      bin,
      council: result.councilData?.council_name || "Newry, Mourne and Down District Council",
      nextTwoCollectionDates: result.dates || [],
      source: "UK Bin Day live council-backed lookup",
      note: result.matched
        ? "Live collection dates found for the selected bin."
        : "The live lookup responded, but two future dates for the selected bin were not returned.",
      diagnostic: {
        reason: result.reason || null,
        councilId: result.councilData?.council_id || null,
        addressCount: result.addressCount || 0,
        sampleAddress: result.sampleAddress || null,
        uprn: result.uprn || null,
        cached: result.cached ?? null,
        collectionsSeen: result.collections || [],
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      matched: false,
      error: error?.message || "Bin lookup failed",
    }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
