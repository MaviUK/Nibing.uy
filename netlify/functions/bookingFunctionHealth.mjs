// Read-only health check of the *deployed* booking function, not a second
// bundle of its dependencies. A GET must be rejected before booking work.
// This verifies that Netlify can initialize and invoke the real handler.
export default async function handler(request) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const headers = { "Cache-Control": "no-store" };
  try {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || !(url.hostname === "nibing.uy" || url.hostname.endsWith(".netlify.app"))) {
      return Response.json({ status: "unavailable", reason: "unexpected_host" }, { status: 503, headers });
    }
    url.pathname = "/.netlify/functions/sendBookingEmail";
    url.search = "";
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 405) {
      return Response.json({ status: "ready", bookingHandler: "deployed_endpoint_responding", check: "read_only_get_405" }, { headers });
    }
    console.error("Booking health probe unexpected status", response.status);
    return Response.json({ status: "unavailable", bookingHandler: "unexpected_response", upstreamStatus: response.status }, { status: 503, headers });
  } catch (error) {
    console.error("Booking health probe failed", error);
    return Response.json({ status: "unavailable", bookingHandler: "probe_failed", reason: "request_failed" }, { status: 503, headers });
  }
}
