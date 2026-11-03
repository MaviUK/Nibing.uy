// netlify/functions/binCalendar.js

function sanitizeCouncilHtml(html) {
  let out = String(html || "");

  // Remove scripts
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");

  // Remove CSS <style> blocks
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Remove external stylesheets
  out = out.replace(/<link[^>]*rel=["']?stylesheet["']?[^>]*>/gi, "");

  // (Optional) remove full document wrappers if they ever appear
  out = out.replace(/<\/?(html|head|body)[^>]*>/gi, "");

  return out.trim();
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const uprn = url.searchParams.get("uprn")?.trim();

    if (!uprn) {
      return new Response(JSON.stringify({ error: "Missing uprn" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const upstream = `https://ardsandnorthdownbincalendar.azurewebsites.net/api/calendarhtml/${encodeURIComponent(
      uprn
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

    // Upstream may return JSON text: {"calendarHTML":"..."}
    const text = await r.text();

    let calendarHTML = "";
    try {
      const parsed = JSON.parse(text);
      calendarHTML = String(parsed?.calendarHTML || "");
    } catch {
      // Fallback: if upstream ever returns raw HTML
      calendarHTML = String(text || "");
    }

    calendarHTML = sanitizeCouncilHtml(calendarHTML);

    if (!calendarHTML) {
      return new Response(JSON.stringify({ error: "No calendar HTML returned" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ html: calendarHTML }), {
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
