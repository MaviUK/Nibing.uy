export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const postcode = url.searchParams.get("postcode")?.trim();

    if (!postcode) {
      return new Response(JSON.stringify({ error: "Missing postcode" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const upstream = `https://ardsandnorthdownbincalendar.azurewebsites.net/api/addresses/${encodeURIComponent(
      postcode
    )}`;

    const r = await fetch(upstream, {
      headers: { "User-Agent": "nibing-bin-checker/1.0" },
    });

    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: "Upstream error", status: r.status }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await r.json();

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Council address data is public and postcode-specific. Reuse successful
        // lookups for six hours across regions; never cache errors.
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control": "public, durable, max-age=21600, stale-while-revalidate=300",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
