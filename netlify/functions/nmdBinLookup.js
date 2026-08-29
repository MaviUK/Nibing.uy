function normalizePostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 5 || compact.length > 7) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function absoluteUrl(href, base) {
  try {
    return new URL(decodeEntities(href), base).href;
  } catch {
    return null;
  }
}

function extractLinks(html, base) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const url = absoluteUrl(match[1], base);
    if (!url) continue;
    const label = stripHtml(match[2]);
    links.push({ url, label });
  }
  return links;
}

function usefulLines(text) {
  const interesting = /\b(black|blue|brown|bin|collection|calendar|schedule|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
  const boilerplate = /^(residents|business|council|about us|information|contact details|search)$/i;
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && line.length < 500 && interesting.test(line) && !boilerplate.test(line))
    .slice(0, 80);
}

function scoreResponse(html, text, links) {
  let score = 0;
  if (/weekly bin collection schedule/i.test(text)) score += 4;
  if (/\bblack bin\b/i.test(text)) score += 2;
  if (/\bblue bin\b/i.test(text)) score += 2;
  if (/\bbrown bin\b/i.test(text)) score += 2;
  if (/\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b/i.test(text)) score += 2;
  if (/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:20)?\d{2}\b/.test(text)) score += 2;
  if (links.some((link) => /\.pdf(?:$|\?)/i.test(link.url))) score += 2;
  if (/pc1|pc2/i.test(html)) score += 1;
  return score;
}

async function fetchCandidate(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NI-Bin-Guy-NMD-test/1.0)",
      Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const html = /text|html|xml/i.test(contentType) ? await response.text() : "";
  const text = stripHtml(html);
  const links = extractLinks(html, response.url || url);
  return {
    requestedUrl: url,
    finalUrl: response.url || url,
    status: response.status,
    ok: response.ok,
    contentType,
    html,
    text,
    links,
    score: scoreResponse(html, text, links),
  };
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const postcode = normalizePostcode(url.searchParams.get("postcode"));
    if (!postcode) {
      return new Response(JSON.stringify({ error: "Enter a valid Northern Ireland postcode." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const compact = postcode.replace(/\s/g, "");
    const pc1 = compact.slice(0, -3);
    const pc2 = compact.slice(-3);
    const base = "https://www.newrymournedown.org/weekly-bin-collection-and-calendar";

    // The council CMS has historically exposed these form values as pc1/pc2.
    // Test both URL styles because its routing has used an ampersand path form as well as query strings.
    const candidates = [
      `${base}&pc1=${encodeURIComponent(pc1)}&pc2=${encodeURIComponent(pc2)}`,
      `${base}?pc1=${encodeURIComponent(pc1)}&pc2=${encodeURIComponent(pc2)}`,
    ];

    const attempts = [];
    for (const candidate of candidates) {
      try {
        attempts.push(await fetchCandidate(candidate));
      } catch (error) {
        attempts.push({ requestedUrl: candidate, ok: false, status: 0, score: -1, error: error?.message || String(error) });
      }
    }

    const best = attempts.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (!best || !best.ok) {
      return new Response(JSON.stringify({
        matched: false,
        postcode,
        reason: "council_request_failed",
        attempts: attempts.map(({ html, text, links, ...rest }) => rest),
      }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }

    const pdfLinks = (best.links || [])
      .filter((link) => /\.pdf(?:$|\?)/i.test(link.url) || /calendar|schedule/i.test(link.label))
      .slice(0, 20);

    const lines = usefulLines(best.text || "");
    const hasReturnedSchedule = best.score >= 5 || pdfLinks.length > 0;

    return new Response(JSON.stringify({
      matched: hasReturnedSchedule,
      postcode,
      postcodeParts: { pc1, pc2 },
      council: "Newry, Mourne and Down District Council",
      source: best.finalUrl,
      httpStatus: best.status,
      score: best.score,
      scheduleLines: lines,
      pdfLinks,
      note: hasReturnedSchedule
        ? "Council response contains schedule/calendar data. This is suitable for the next parsing step."
        : "The council page responded, but no postcode-specific schedule was detected yet. The diagnostic lines below show what it returned.",
      attempts: attempts.map(({ html, text, links, ...rest }) => rest),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
