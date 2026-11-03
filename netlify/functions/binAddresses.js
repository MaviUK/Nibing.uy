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
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
