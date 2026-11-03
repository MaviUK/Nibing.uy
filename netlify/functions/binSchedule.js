export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const postcode = url.searchParams.get("postcode");

    if (!postcode) {
      return new Response(JSON.stringify({ error: "Missing postcode" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const cleanPostcode = postcode.replace(/\s+/g, "%20").toUpperCase();

    const councilUrl = `https://www.ardsandnorthdown.gov.uk/article/1141/Bins-and-recycling?postcode=${cleanPostcode}`;

    const res = await fetch(councilUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html"
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Council lookup failed" }), { status: 502 });
    }

    const html = await res.text();

    // ---- PARSE ADDRESS ----
    const addressMatch = html.match(/My address:\s*<\/strong>\s*([^<]+)/i);
    const address = addressMatch ? addressMatch[1].trim() : "";

    // ---- PARSE BIN DATES ----
    const bins = [];
    const patterns = [
      { type: "Grey", regex: /Grey Bin:\s*([A-Za-z]{3}\s\d{2}\s[A-Za-z]{3})/ },
      { type: "Blue", regex: /Blue Bin:\s*([A-Za-z]{3}\s\d{2}\s[A-Za-z]{3})/ },
      { type: "Green\/Brown", regex: /Green\/Brown Bin:\s*([A-Za-z]{3}\s\d{2}\s[A-Za-z]{3})/ },
      { type: "Glass", regex: /Glass Collection Box:\s*([A-Za-z]{3}\s\d{2}\s[A-Za-z]{3})/ }
    ];

    for (const p of patterns) {
      const m = html.match(p.regex);
      if (m) {
        const date = new Date(`${m[1]} ${new Date().getFullYear()}`);
        bins.push({
          type: p.type,
          date: date.toISOString().slice(0, 10)
        });
      }
    }

    return new Response(
      JSON.stringify({
        postcode,
        address,
        next: bins
      }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
