// Isolated read-only diagnostic: failures in the booking handler must not crash
// this diagnostic's own module initialization. No customer data or writes.
export default async function handler(request) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const headers = { "Cache-Control": "no-store" };
  try {
    // Dynamic import is deliberately inside try: the booking module and its
    // transitive Netlify storage dependencies may fail to initialize.
    const booking = await import("./sendBookingEmail.js");
    if (typeof (booking.handler || booking.default?.handler) !== "function") {
      throw new Error("booking_handler_missing");
    }
    return Response.json({ status: "ready", bookingHandler: "loaded" }, { headers });
  } catch (error) {
    console.error("Booking module startup failed", error);
    const reason = error?.message === "booking_handler_missing" ? "handler_export_missing"
      : error?.code === "ERR_REQUIRE_ESM" ? "module_format_incompatible"
      : error?.code === "MODULE_NOT_FOUND" || error?.code === "ERR_MODULE_NOT_FOUND" ? "module_missing"
      : error instanceof SyntaxError ? "syntax_error"
      : error instanceof ReferenceError ? "reference_error"
      : error instanceof TypeError ? "type_error" : "module_initialization_error";
    return Response.json({ status: "unavailable", bookingHandler: "startup_failed", reason },
      { status: 503, headers });
  }
}
