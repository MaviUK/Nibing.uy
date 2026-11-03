import { gunzipSync } from "node:zlib";

const LOOKUP_GZIP_BASE64 = "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";

function normalizePostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

function normalizeStreet(value) {
  const first = String(value || "").split(",")[0].toUpperCase().trim();
  return first
    .replace(/^\d+[A-Z]?(?:[-/]\d+[A-Z]?)?\s+/, "")
    .replace(/[.'’]/g, "")
    .replace(/\bRD\b/g, "ROAD")
    .replace(/\bST\b/g, "STREET")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/\bDR\b/g, "DRIVE")
    .replace(/\bLN\b/g, "LANE")
    .replace(/\bCT\b/g, "COURT")
    .replace(/\bCRES\b/g, "CRESCENT")
    .replace(/\bCL\b/g, "CLOSE")
    .replace(/\bMNR\b/g, "MANOR")
    .replace(/\bWY\b/g, "WAY")
    .replace(/\bGRN\b/g, "GREEN")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBin(value) {
  const s = String(value || "").toUpperCase();
  if (s.includes("GREY") || s.includes("GRAY") || s.includes("BLACK")) return "BLACK";
  if (s.includes("BLUE")) return "BLUE";
  if (s.includes("GREEN") || s.includes("BROWN")) return "BROWN";
  return s.trim();
}

function parseLookupRows() {
  const csv = gunzipSync(Buffer.from(LOOKUP_GZIP_BASE64, "base64")).toString("utf8");
  return csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [postcode, street, service, round, anchorDate] = line.split(",");
    return {
      postcode: normalizePostcode(postcode),
      street: normalizeStreet(street),
      service: String(service || "").toUpperCase(),
      round,
      anchorDate,
    };
  });
}

function nextOccurrence(anchorDate, fromDate) {
  const DAY = 86400000;
  const PERIOD = 28 * DAY;
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const from = new Date(`${fromDate}T00:00:00Z`);
  if (from <= anchor) return anchorDate;
  const periods = Math.ceil((from - anchor) / PERIOD);
  return new Date(anchor.getTime() + periods * PERIOD).toISOString().slice(0, 10);
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const postcode = normalizePostcode(url.searchParams.get("postcode"));
    const address = url.searchParams.get("address") || "";
    const bin = normalizeBin(url.searchParams.get("bin"));
    const from = url.searchParams.get("from") || new Date().toISOString().slice(0, 10);

    if (!postcode || !address || !bin) {
      return new Response(JSON.stringify({ error: "postcode, address and bin are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const street = normalizeStreet(address);
    const rows = parseLookupRows();
    const exact = rows.filter((r) => r.postcode === postcode && r.street === street && r.service.includes(bin));

    let matches = exact;
    let confidence = "exact";

    if (!matches.length) {
      matches = rows.filter((r) => r.street === street && r.service.includes(bin));
      confidence = matches.length ? "street" : "none";
    }

    const unique = [...new Map(matches.map((m) => [`${m.round}|${m.anchorDate}`, m])).values()];

    if (!unique.length) {
      return new Response(JSON.stringify({ matched: false, postcode, street, bin }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (unique.length > 1) {
      return new Response(JSON.stringify({
        matched: false,
        ambiguous: true,
        confidence,
        postcode,
        street,
        bin,
        candidates: unique.map((m) => ({ round: m.round, anchorDate: m.anchorDate, nextCleanDate: nextOccurrence(m.anchorDate, from) })),
      }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const match = unique[0];
    return new Response(JSON.stringify({
      matched: true,
      confidence,
      postcode,
      street,
      bin,
      round: match.round,
      anchorDate: match.anchorDate,
      nextCleanDate: nextOccurrence(match.anchorDate, from),
      frequencyDays: 28,
    }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Round lookup failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const config = {
  path: "/api/round-lookup",
};
