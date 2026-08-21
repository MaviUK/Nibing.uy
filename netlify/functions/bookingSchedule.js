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
  const aliases = wantedBin === "GREY" ? ["GREY BIN", "GRAY BIN", "BLACK BIN"] : wantedBin === "BLUE" ? ["BLUE BIN"] : ["GREEN/BROWN BIN", "GREEN BROWN BIN", "BROWN BIN", "GREEN BIN"];
  const dateRe = /\b(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(20\d{2})\b/g;
  const months = { JANUARY:0,FEBRUARY:1,MARCH:2,APRIL:3,MAY:4,JUNE:5,JULY:6,AUGUST:7,SEPTEMBER:8,OCTOBER:9,NOVEMBER:10,DECEMBER:11 };
  const dates = [];
  for (const alias of aliases) {
    let pos = text.indexOf(alias);
    while (pos >= 0) {
      const window = text.slice(pos, pos + 240);
      let m;
      dateRe.lastIndex = 0;
      while ((m = dateRe.exec(window))) {
        const d = new Date(Date.UTC(Number(m[3]), months[m[2]], Number(m[1])));
        dates.push(d.toISOString().slice(0,10));
      }
      pos = text.indexOf(alias, pos + alias.length);
    }
  }
  return [...new Set(dates)].sort();
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
    const addrRes = await fetch(new URL(`/.netlify/functions/binLookup?postcode=${encodeURIComponent(postcode)}`, origin));
    const addrData = await addrRes.json();
    if (!addrRes.ok || !Array.isArray(addrData.addresses) || !addrData.addresses.length) return new Response(JSON.stringify({ matched:false, reason:"council_address_not_found", postcode }), { status: 200, headers:{"Content-Type":"application/json"} });

    const ranked = addrData.addresses.map((a) => ({ ...a, score: addressScore(address, a.label) })).sort((a,b) => b.score-a.score);
    const chosen = ranked[0];
    if (!chosen || chosen.score < 20) return new Response(JSON.stringify({ matched:false, reason:"council_address_ambiguous", candidates:ranked.slice(0,3) }), { status:200, headers:{"Content-Type":"application/json"} });

    const calRes = await fetch(new URL(`/.netlify/functions/binCalendar?uprn=${encodeURIComponent(chosen.uprn)}`, origin));
    const calData = await calRes.json();
    if (!calRes.ok || !calData.html) return new Response(JSON.stringify({ matched:false, reason:"council_calendar_failed" }), { status:200, headers:{"Content-Type":"application/json"} });

    const results = [];
    for (const bin of bins) {
      const councilBin = normalizeBin(bin.type || bin);
      const councilDates = parseCouncilDates(calData.html, councilBin);
      const roundUrl = new URL("/api/round-lookup", origin);
      roundUrl.searchParams.set("postcode", postcode);
      roundUrl.searchParams.set("address", address);
      roundUrl.searchParams.set("bin", String(bin.type || bin));
      const roundRes = await fetch(roundUrl);
      const round = await roundRes.json().catch(() => ({}));
      let assigned = null;
      if (roundRes.ok && round.matched && councilDates.length) {
        const anchor = new Date(`${round.anchorDate}T12:00:00Z`).getTime();
        for (const d of councilDates) {
          const t = new Date(`${d}T12:00:00Z`).getTime();
          if (t >= Date.now() - 86400000 && (t - anchor) % (28 * 86400000) === 0) { assigned = d; break; }
        }
      }
      results.push({ bin: bin.type || bin, councilBin, councilDates, round, assignedCleanDate: assigned, automatic: Boolean(assigned) });
    }

    return new Response(JSON.stringify({ matched: results.every((r) => r.automatic), postcode, councilAddress: chosen.label, uprn: chosen.uprn, results }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Booking schedule failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

export const config = { path: "/api/booking-schedule" };
