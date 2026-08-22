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

  const allHeadings = [
    "GREY BIN", "GRAY BIN", "BLACK BIN", "BLUE BIN",
    "GREEN/BROWN BIN", "GREEN BROWN BIN", "BROWN BIN", "GREEN BIN",
    "GLASS COLLECTION BOX", "GLASS BOX", "TRADE"
  ];

  const mn = {
    JAN: 0, JANUARY: 0, FEB: 1, FEBRUARY: 1, MAR: 2, MARCH: 2,
    APR: 3, APRIL: 3, MAY: 4, JUN: 5, JUNE: 5, JUL: 6, JULY: 6,
    AUG: 7, AUGUST: 7, SEP: 8, SEPT: 8, SEPTEMBER: 8, OCT: 9,
    OCTOBER: 9, NOV: 10, NOVEMBER: 10, DEC: 11, DECEMBER: 11,
  };

  const weekdayNumber = {
    SUN: 0, SUNDAY: 0,
    MON: 1, MONDAY: 1,
    TUE: 2, TUES: 2, TUESDAY: 2,
    WED: 3, WEDNESDAY: 3,
    THU: 4, THUR: 4, THURS: 4, THURSDAY: 4,
    FRI: 5, FRIDAY: 5,
    SAT: 6, SATURDAY: 6,
  };

  const lr = /\b(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(20\d{2})\b/g;
  const sr = /\b(?:MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT|SUN)\s+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)(?:\s+(20\d{2}))?\b/g;
  const now = new Date();

  function makeDate(d, m, y) {
    const mo = mn[m];
    if (mo == null) return null;
    let yr = y ? Number(y) : now.getUTCFullYear();
    let dt = new Date(Date.UTC(yr, mo, Number(d)));
    if (!y && dt.getTime() < now.getTime() - 120 * 86400000) {
      yr += 1;
      dt = new Date(Date.UTC(yr, mo, Number(d)));
    }
    return dt;
  }

  function nextAlternateDate(firstDate, targetWeekday) {
    const approx = new Date(firstDate.getTime() + 14 * 86400000);
    if (!Number.isInteger(targetWeekday)) return approx;
    const currentWeekday = approx.getUTCDay();
    let shift = targetWeekday - currentWeekday;
    if (shift > 3) shift -= 7;
    if (shift < -3) shift += 7;
    const adjusted = new Date(approx.getTime() + shift * 86400000);
    return adjusted.getTime() > firstDate.getTime() ? adjusted : approx;
  }

  function findSection(alias) {
    let start = text.indexOf(alias);
    if (start < 0) return "";
    start += alias.length;
    let end = text.length;
    for (const heading of allHeadings) {
      let pos = text.indexOf(heading, start);
      if (pos >= 0 && pos < end) end = pos;
    }
    return text.slice(start, end);
  }

  for (const alias of aliases) {
    const section = findSection(alias);
    if (!section) continue;

    const found = [];
    let match;

    lr.lastIndex = 0;
    while ((match = lr.exec(section))) {
      const date = makeDate(match[1], match[2], match[3]);
      if (date) found.push(date);
    }

    sr.lastIndex = 0;
    while ((match = sr.exec(section))) {
      const date = makeDate(match[1], match[2], match[3]);
      if (date) found.push(date);
    }

    const unique = [...new Map(found.map((date) => [date.toISOString().slice(0, 10), date])).values()]
      .sort((a, b) => a.getTime() - b.getTime());

    if (!unique.length) continue;

    const first = unique[0];
    const dates = [first];

    if (unique.length > 1) {
      dates.push(unique[1]);
    } else {
      const recurrence = section.match(/EVERY\s+ALTERNATE\s+(MON(?:DAY)?|TUE(?:S|SDAY)?|WED(?:NESDAY)?|THU(?:R|RS|RSDAY)?|FRI(?:DAY)?|SAT(?:URDAY)?|SUN(?:DAY)?)/i);
      if (recurrence) {
        const key = recurrence[1].toUpperCase();
        const targetWeekday = weekdayNumber[key] ?? weekdayNumber[key.slice(0, 3)];
        dates.push(nextAlternateDate(first, targetWeekday));
      }
    }

    return [...new Set(dates.map((date) => date.toISOString().slice(0, 10)))].sort();
  }

  return [];
}

const DAY_MS = 86400000;
const MAX_AREA_DISTANCE_METERS = 1800;

function nextTwoCouncilDates(councilDates) {
  const today = new Date();
  const floor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).getTime();
  return (Array.isArray(councilDates) ? councilDates : [])
    .filter((date) => {
      const t = new Date(`${date}T12:00:00Z`).getTime();
      return Number.isFinite(t) && t >= floor - DAY_MS;
    })
    .sort()
    .slice(0, 2);
}

function candidateDate(candidate) {
  return candidate?.nextCleanDate || candidate?.assignedCleanDate || null;
}

function chooseAreaMatchForNextTwo(round, councilDates, method = "round_lookup") {
  const nextTwo = nextTwoCouncilDates(councilDates);
  if (!nextTwo.length || !round) return null;

  const candidates = [];

  if (round.matched) {
    const date = candidateDate(round);
    if (date) {
      candidates.push({
        ...round,
        nextCleanDate: date,
        nearestDistanceMeters: Number(round.nearestDistanceMeters ?? 0),
      });
    }
  }

  if (Array.isArray(round.candidates)) {
    for (const candidate of round.candidates) {
      const date = candidateDate(candidate);
      if (!date) continue;
      candidates.push({ ...candidate, nextCleanDate: date });
    }
  }

  for (const councilDate of nextTwo) {
    const matches = candidates
      .filter((candidate) => candidate.nextCleanDate === councilDate)
      .filter((candidate) => Number(candidate.nearestDistanceMeters ?? Infinity) <= MAX_AREA_DISTANCE_METERS)
      .sort((a, b) => Number(a.nearestDistanceMeters ?? Infinity) - Number(b.nearestDistanceMeters ?? Infinity));

    if (!matches.length) continue;

    const winner = matches[0];
    return {
      round: {
        ...round,
        matched: true,
        ambiguous: false,
        resolvedBy: "next_two_council_dates_area_match",
        sourceMethod: method,
        round: winner.round ?? round.round,
        anchorDate: winner.anchorDate ?? round.anchorDate,
        nextCleanDate: councilDate,
        councilValidationDate: councilDate,
        nearestDistanceMeters: winner.nearestDistanceMeters,
        support: winner.support,
        candidates: round.candidates,
      },
      assignedCleanDate: councilDate,
      checkedCouncilDates: nextTwo,
    };
  }

  return null;
}

function extractTown(councilAddress, postcode) {
  const postcodeCompact = String(postcode || "").replace(/\s+/g, "");
  const parts = String(councilAddress || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !postcodeCompact || part.replace(/\s+/g, "").toUpperCase() !== postcodeCompact.toUpperCase());

  if (parts.length >= 2) return parts[parts.length - 1];
  return "";
}

function totalSupportForDate(rounds, date) {
  let total = 0;
  const seen = new Set();

  for (const round of rounds) {
    for (const candidate of round?.candidates || []) {
      if (candidateDate(candidate) !== date) continue;
      const key = `${candidate.round || ""}|${candidate.anchorDate || candidateDate(candidate)}|${round.service || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += Math.max(1, Number(candidate.support || 1));
    }
  }

  return total;
}

async function chooseTownWorkloadMatch(origin, postcode, town, councilDates) {
  const nextTwo = nextTwoCouncilDates(councilDates);
  if (!town || !nextTwo.length) return null;

  const services = ["Black", "Blue", "Brown"];
  const townRounds = [];

  for (const service of services) {
    const round = await getNearbyRound(origin, postcode, town, service);
    if (round) townRounds.push({ ...round, service });
  }

  if (!townRounds.length) return null;

  const scoredDates = nextTwo.map((date) => ({
    date,
    support: totalSupportForDate(townRounds, date),
  }));

  const viable = scoredDates
    .filter((item) => item.support > 0)
    .sort((a, b) => (b.support - a.support) || a.date.localeCompare(b.date));

  if (!viable.length) return null;

  const winner = viable[0];
  return {
    round: {
      matched: true,
      ambiguous: false,
      resolvedBy: "town_workload_on_next_two_council_dates",
      town,
      nextCleanDate: winner.date,
      councilValidationDate: winner.date,
      support: winner.support,
      townDateSupport: scoredDates,
    },
    assignedCleanDate: winner.date,
    checkedCouncilDates: nextTwo,
  };
}

function normalizeAddressList(payload) {
  let list = payload?.data?.addresses;
  if (!Array.isArray(list) && Array.isArray(payload?.addresses)) list = payload.addresses;
  if (!Array.isArray(list) && payload?.addresses && typeof payload.addresses === "object") list = Object.values(payload.addresses);

  return (list || []).map((item) => {
    if (!item || typeof item !== "object") return null;
    const uprn = String(item.uprn || item.UPRN || "").trim();
    const label = String(item.addressText || item.address || item.label || "").trim();
    return uprn && label ? { uprn, label } : null;
  }).filter(Boolean);
}

async function getCouncilAddresses(origin, postcode) {
  const directRes = await fetch(new URL(`/.netlify/functions/binAddresses?postcode=${encodeURIComponent(postcode)}`, origin));
  const directData = await directRes.json().catch(() => ({}));
  const directAddresses = directRes.ok ? normalizeAddressList(directData) : [];
  if (directAddresses.length) return { source: "binAddresses", addresses: directAddresses };

  const fallbackRes = await fetch(new URL(`/.netlify/functions/binLookup?postcode=${encodeURIComponent(postcode)}`, origin));
  const fallbackData = await fallbackRes.json().catch(() => ({}));
  const fallbackAddresses = Array.isArray(fallbackData.addresses)
    ? fallbackData.addresses.map((i) => ({
        uprn: String(i.uprn || "").trim(),
        label: String(i.label || "").trim(),
      })).filter((i) => i.uprn && i.label)
    : [];

  return { source: "binLookup", addresses: fallbackRes.ok ? fallbackAddresses : [] };
}

async function getNearbyRound(origin, postcode, address, bin) {
  const u = new URL("/api/nearby-round-lookup", origin);
  u.searchParams.set("postcode", postcode);
  u.searchParams.set("address", address);
  u.searchParams.set("bin", String(bin));
  const r = await fetch(u);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(data.candidates) || !data.candidates.length) return null;
  return {
    matched: false,
    ambiguous: true,
    confidence: "nearby",
    method: data.method,
    locationSource: data.locationSource,
    candidates: data.candidates,
  };
}

export default async function handler(req) {
  try {
    const body = req.method === "POST" ? await req.json() : {};
    const url = new URL(req.url);
    const address = String(body.address || url.searchParams.get("address") || "").trim();
    const postcode = normalizePostcode(
      body.postcode ||
      url.searchParams.get("postcode") ||
      address.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]
    );
    const bins = (Array.isArray(body.bins) ? body.bins : [url.searchParams.get("bin")]).filter(Boolean);

    if (!address || !postcode || !bins.length) {
      return new Response(JSON.stringify({ error: "address, postcode and bins are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const origin = new URL(req.url).origin;
    const councilAddressLookup = await getCouncilAddresses(origin, postcode);

    if (!councilAddressLookup.addresses.length) {
      return new Response(JSON.stringify({
        matched: false,
        reason: "council_address_not_found",
        postcode,
        addressSource: councilAddressLookup.source,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ranked = councilAddressLookup.addresses
      .map((a) => ({ ...a, score: addressScore(address, a.label) }))
      .sort((a, b) => b.score - a.score);
    const chosen = ranked[0];

    if (!chosen || chosen.score < 20) {
      return new Response(JSON.stringify({
        matched: false,
        reason: "council_address_ambiguous",
        addressSource: councilAddressLookup.source,
        candidates: ranked.slice(0, 3),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const calRes = await fetch(new URL(`/.netlify/functions/binCalendar?uprn=${encodeURIComponent(chosen.uprn)}`, origin));
    const calData = await calRes.json().catch(() => ({}));

    if (!calRes.ok || !calData.html) {
      return new Response(JSON.stringify({
        matched: false,
        reason: "council_calendar_failed",
        addressSource: councilAddressLookup.source,
        councilAddress: chosen.label,
        uprn: chosen.uprn,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const town = extractTown(chosen.label, postcode);
    const results = [];

    for (const bin of bins) {
      const binName = bin.type || bin;
      const councilBin = normalizeBin(binName);
      const councilDates = parseCouncilDates(calData.html, councilBin);
      const nextTwo = nextTwoCouncilDates(councilDates);

      const roundUrl = new URL("/api/round-lookup", origin);
      roundUrl.searchParams.set("postcode", postcode);
      roundUrl.searchParams.set("address", address);
      roundUrl.searchParams.set("bin", String(binName));

      const roundResponse = await fetch(roundUrl);
      const rawRound = await roundResponse.json().catch(() => ({}));

      let resolved = chooseAreaMatchForNextTwo(rawRound, councilDates, rawRound?.method || "round_lookup");
      let round = resolved?.round || rawRound;

      if (!resolved && nextTwo.length) {
        const nearbyRound = await getNearbyRound(origin, postcode, chosen.label || address, binName);
        if (nearbyRound) {
          const nearbyResolved = chooseAreaMatchForNextTwo(
            nearbyRound,
            councilDates,
            nearbyRound.method || "nearby_round_lookup"
          );
          if (nearbyResolved) {
            resolved = nearbyResolved;
            round = nearbyResolved.round;
          } else if (!rawRound?.matched) {
            round = nearbyRound;
          }
        }
      }

      if (!resolved && nextTwo.length && town) {
        const townResolved = await chooseTownWorkloadMatch(origin, postcode, town, councilDates);
        if (townResolved) {
          resolved = townResolved;
          round = townResolved.round;
        }
      }

      const assigned = resolved?.assignedCleanDate || null;

      results.push({
        bin: binName,
        councilBin,
        councilDates,
        nextTwoCouncilDates: nextTwo,
        town,
        round,
        assignedCleanDate: assigned,
        automatic: Boolean(assigned),
      });
    }

    return new Response(JSON.stringify({
      matched: results.every((r) => r.automatic),
      postcode,
      addressSource: councilAddressLookup.source,
      councilAddress: chosen.label,
      town,
      uprn: chosen.uprn,
      results,
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Booking schedule failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const config = { path: "/api/booking-schedule" };
