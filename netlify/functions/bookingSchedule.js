function normalizePostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normAddress(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\bNORTHERN IRELAND\b/g, "")
    .replace(/[.,'’]/g, " ")
    .replace(/\bRD\b/g, "ROAD")
    .replace(/\bST\b/g, "STREET")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/\s+/g, " ")
    .trim();
}

function addressScore(wanted, candidate) {
  const a = normAddress(wanted);
  const b = normAddress(candidate);
  if (a === b) return 100;
  const house = a.match(/^\d+[A-Z]?\b/)?.[0];
  let score = house && b.includes(house) ? 25 : 0;
  const tokens = a.split(" ").filter((t) => t.length > 2);
  score += tokens.filter((t) => b.includes(t)).length * 5;
  return score;
}

function normalizeBin(value) {
  const s = String(value || "").toUpperCase();
  if (s.includes("BLACK") || s.includes("GREY") || s.includes("GRAY")) return "GREY";
  if (s.includes("BLUE")) return "BLUE";
  if (s.includes("BROWN") || s.includes("GREEN")) return "GREEN/BROWN";
  return s;
}

function parseCouncilDates(html, wantedBin) {
  const text = stripHtml(html).toUpperCase();
  const aliases = wantedBin === "GREY"
    ? ["GREY BIN", "GRAY BIN", "BLACK BIN"]
    : wantedBin === "BLUE"
      ? ["BLUE BIN"]
      : ["GREEN/BROWN BIN", "GREEN BROWN BIN", "BROWN BIN", "GREEN BIN"];

  const monthNumber = {
    JAN: 0, JANUARY: 0,
    FEB: 1, FEBRUARY: 1,
    MAR: 2, MARCH: 2,
    APR: 3, APRIL: 3,
    MAY: 4,
    JUN: 5, JUNE: 5,
    JUL: 6, JULY: 6,
    AUG: 7, AUGUST: 7,
    SEP: 8, SEPT: 8, SEPTEMBER: 8,
    OCT: 9, OCTOBER: 9,
    NOV: 10, NOVEMBER: 10,
    DEC: 11, DECEMBER: 11,
  };

  const longDateRe = /\b(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(20\d{2})\b/g;
  const shortDateRe = /\b(?:MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT|SUN)\s+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)(?:\s+(20\d{2}))?\b/g;
  const dates = [];
  const now = new Date();

  function addDate(day, monthName, explicitYear) {
    const month = monthNumber[monthName];
    if (month == null) return;
    let year = explicitYear ? Number(explicitYear) : now.getUTCFullYear();
    let d = new Date(Date.UTC(year, month, Number(day)));
    if (!explicitYear && d.getTime() < now.getTime() - 120 * 86400000) {
      year += 1;
      d = new Date(Date.UTC(year, month, Number(day)));
    }
    dates.push(d.toISOString().slice(0, 10));
  }

  for (const alias of aliases) {
    let pos = text.indexOf(alias);
    while (pos >= 0) {
      const window = text.slice(pos, pos + 260);
      let m;

      longDateRe.lastIndex = 0;
      while ((m = longDateRe.exec(window))) addDate(m[1], m[2], m[3]);

      shortDateRe.lastIndex = 0;
      while ((m = shortDateRe.exec(window))) addDate(m[1], m[2], m[3]);

      pos = text.indexOf(alias, pos + alias.length);
    }
  }

  return [...new Set(dates)].sort();
}

const DAY_MS = 86400000;
const ROUND_MS = 28 * DAY_MS;

function alignedCouncilDate(anchorDate, councilDates) {
  if (!anchorDate || !Array.isArray(councilDates) || !councilDates.length) return null;
  const anchor = new Date(`${anchorDate}T12:00:00Z`).getTime();
  if (!Number.isFinite(anchor)) return null;

  for (const date of councilDates) {
    const t = new Date(`${date}T12:00:00Z`).getTime();
    if (!Number.isFinite(t) || t < Date.now() - DAY_MS) continue;
    const delta = t - anchor;
    if (((delta % ROUND_MS) + ROUND_MS) % ROUND_MS === 0) return date;
  }
  return null;
}

function resolveRoundWithCouncilDates(round, councilDates) {
  if (round?.matched && round.anchorDate) {
    const assignedCleanDate = alignedCouncilDate(round.anchorDate, councilDates);
    return assignedCleanDate ? { round, assignedCleanDate } : null;
  }

  if (!round?.ambiguous || !Array.isArray(round.candidates)) return null;

  const aligned = round.candidates
    .map((candidate) => ({
      candidate,
      assignedCleanDate: alignedCouncilDate(candidate.anchorDate, councilDates),
    }))
    .filter((item) => item.assignedCleanDate);

  if (aligned.length !== 1) return null;

  const winner = aligned[0];
  return {
    round: {
      ...round,
      matched: true,
      ambiguous: false,
      resolvedBy: "council_date_phase",
      round: winner.candidate.round,
      anchorDate: winner.candidate.anchorDate,
      nextCleanDate: winner.candidate.nextCleanDate,
      candidates: round.candidates,
    },
    assignedCleanDate: winner.assignedCleanDate,
  };
}

function normalizeAddressList(payload) {
  let list = payload?.data?.addresses;
  if (!Array.isArray(list) && Array.isArray(payload?.addresses)) list = payload.addresses;
  if (!Array.isArray(list) && payload?.addresses && typeof payload.addresses === "object") list = Object.values(payload.addresses);

  return (list || [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const uprn = String(item.uprn || item.UPRN || "").trim();
      const label = String(item.addressText || item.address || item.label || "").trim();
      return uprn && label ? { uprn, label } : null;
    })
    .filter(Boolean);
}

async function getCouncilAddresses(origin, postcode) {
  const directRes = await fetch(new URL(`/.netlify/functions/binAddresses?postcode=${encodeURIComponent(postcode)}`, origin));
  const directData = await directRes.json().catch(() => ({}));
  const directAddresses = directRes.ok ? normalizeAddressList(directData) : [];
  if (directAddresses.length) return { source: "binAddresses", addresses: directAddresses };

  const fallbackRes = await fetch(new URL(`/.netlify/functions/binLookup?postcode=${encodeURIComponent(postcode)}`, origin));
  const fallbackData = await fallbackRes.json().catch(() => ({}));
  const fallbackAddresses = Array.isArray(fallbackData.addresses)
    ? fallbackData.addresses.map((item) => ({ uprn: String(item.uprn || "").trim(), label: String(item.label || "").trim() })).filter((item) => item.uprn && item.label)
    : [];

  return { source: "binLookup", addresses: fallbackRes.ok ? fallbackAddresses : [] };
}

export default async function handler(req) {
  try {
    const body = req.method === "POST" ? await req.json() : {};
    const url = new URL(req.url);
    const address = String(body.address || url.searchParams.get("address") || "").trim();
    const postcode = normalizePostcode(body.postcode || url.searchParams.get("postcode") || address.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]);
    const bins = (Array.isArray(body.bins) ? body.bins : [url.searchParams.get("bin")]).filter(Boolean);
    if (!address || !postcode || !bins.length) return new Response(JSON.stringify({ error: "address, postcode and bins are required" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const origin = new URL(req.url).origin;
    const councilAddressLookup = await getCouncilAddresses(origin, postcode);
    if (!councilAddressLookup.addresses.length) {
      return new Response(JSON.stringify({ matched:false, reason:"council_address_not_found", postcode, addressSource:councilAddressLookup.source }), { status: 200, headers:{"Content-Type":"application/json"} });
    }

    const ranked = councilAddressLookup.addresses.map((a) => ({ ...a, score: addressScore(address, a.label) })).sort((a,b) => b.score-a.score);
    const chosen = ranked[0];
    if (!chosen || chosen.score < 20) {
      return new Response(JSON.stringify({ matched:false, reason:"council_address_ambiguous", addressSource:councilAddressLookup.source, candidates:ranked.slice(0,3) }), { status:200, headers:{"Content-Type":"application/json"} });
    }

    const calRes = await fetch(new URL(`/.netlify/functions/binCalendar?uprn=${encodeURIComponent(chosen.uprn)}`, origin));
    const calData = await calRes.json().catch(() => ({}));
    if (!calRes.ok || !calData.html) return new Response(JSON.stringify({ matched:false, reason:"council_calendar_failed", addressSource:councilAddressLookup.source, councilAddress:chosen.label, uprn:chosen.uprn }), { status:200, headers:{"Content-Type":"application/json"} });

    const results = [];
    for (const bin of bins) {
      const councilBin = normalizeBin(bin.type || bin);
      const councilDates = parseCouncilDates(calData.html, councilBin);
      const roundUrl = new URL("/api/round-lookup", origin);
      roundUrl.searchParams.set("postcode", postcode);
      roundUrl.searchParams.set("address", address);
      roundUrl.searchParams.set("bin", String(bin.type || bin));
      const roundRes = await fetch(roundUrl);
      const rawRound = await roundRes.json().catch(() => ({}));
      const resolved = resolveRoundWithCouncilDates(rawRound, councilDates);
      const round = resolved?.round || rawRound;
      const assigned = resolved?.assignedCleanDate || null;

      results.push({
        bin: bin.type || bin,
        councilBin,
        councilDates,
        round,
        assignedCleanDate: assigned,
        automatic: Boolean(assigned),
      });
    }

    return new Response(JSON.stringify({ matched: results.every((r) => r.automatic), postcode, addressSource:councilAddressLookup.source, councilAddress: chosen.label, uprn: chosen.uprn, results }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Booking schedule failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

export const config = { path: "/api/booking-schedule" };
