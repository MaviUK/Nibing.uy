// netlify/functions/binLookup.js

function normalizeUkPostcode(raw) {
  const s = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (s.length <= 3) return s;
  return s.slice(0, -3) + " " + s.slice(-3);
}

function decodeHtml(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function looksLikeAddress(label, postcode) {
  const l = (label || "").trim();
  if (!l) return false;

  // reject junk options like "1", "2"
  if (/^\d+$/.test(l)) return false;

  // must contain letters
  if (!/[A-Z]/i.test(l)) return false;

  // often has comma OR a house number
  const hasComma = l.includes(",");
  const hasHouseNo = /\b\d{1,4}\b/.test(l);

  // if postcode is present, great (but don’t require it)
  const pc = (postcode || "").toUpperCase().replace(/\s/g, "");
  const lpc = l.toUpperCase().replace(/\s/g, "");
  const hasPostcode = pc && lpc.includes(pc);

  return hasComma || hasHouseNo || hasPostcode;
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const postcodeRaw = url.searchParams.get("postcode");

    if (!postcodeRaw) {
      return new Response(JSON.stringify({ error: "Missing postcode" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const postcode = normalizeUkPostcode(postcodeRaw);

    const councilUrl =
      "https://www.ardsandnorthdown.gov.uk/article/1141/Bins-and-recycling?postcode=" +
      encodeURIComponent(postcode);

    const res = await fetch(councilUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
      },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Council lookup failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const html = await res.text();

    // --- 1) Try “My address” (single address case) ---
    const myAddr = html.match(/My address:\s*<\/strong>\s*([\s\S]*?)<\/p>/i);
    if (myAddr?.[1]) {
      const addr = decodeHtml(myAddr[1].replace(/<[^>]+>/g, " "));
      if (looksLikeAddress(addr, postcode)) {
        return new Response(
          JSON.stringify({
            postcode,
            addresses: [{ uprn: postcode, label: addr }],
            debug: { mode: "my_address", councilUrl },
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // --- 2) Try to locate the address <select> block only ---
    // This hunts for a select that includes the text "Select your address"
    // and only parses option tags inside that select.
    let selectBlock = "";
    const selectMatch = html.match(
      /<select[^>]*>[\s\S]*?Select your address[\s\S]*?<\/select>/i
    );
    if (selectMatch?.[0]) selectBlock = selectMatch[0];

    // fallback: sometimes wording differs, so look for a select with "address" in id/name
    if (!selectBlock) {
      const alt = html.match(/<select[^>]*(id|name)="[^"]*address[^"]*"[\s\S]*?<\/select>/i);
      if (alt?.[0]) selectBlock = alt[0];
    }

    const options = [];
    const optionRe = /<option[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi;

    const source = selectBlock || html; // if we can't find the block, fallback to html but filter hard
    let m;
    while ((m = optionRe.exec(source))) {
      const value = decodeHtml(m[1]);
      const label = decodeHtml(m[2].replace(/<[^>]+>/g, " "));
      if (!looksLikeAddress(label, postcode)) continue;
      options.push({ uprn: value, label });
    }

    // Deduplicate
    const seen = new Set();
    const clean = options.filter((a) => {
      const key = (a.label || "").toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return new Response(
      JSON.stringify({
        postcode,
        addresses: clean,
        debug: { mode: selectBlock ? "select_block" : "fallback_filtered", councilUrl },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
