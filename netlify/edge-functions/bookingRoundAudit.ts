import type { Config, Context } from "@netlify/edge-functions";

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

function extractPostcode(address: unknown) {
  const match = String(address || "").toUpperCase().match(UK_POSTCODE_RE);
  if (!match) return "";
  const compact = match[1].replace(/\s+/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return context.next();

  try {
    const payload = await req.clone().json();
    const address = String(payload?.address || "").trim();
    const postcode = extractPostcode(address);
    const bins = Array.isArray(payload?.bins) ? payload.bins.filter((bin: any) => bin?.type) : [];

    if (!address || !postcode || !bins.length) {
      console.info("[round-audit] skipped", {
        reason: !address ? "missing_address" : !postcode ? "postcode_not_found" : "missing_bins",
        address,
      });
      return context.next();
    }

    const origin = new URL(req.url).origin;
    let schedule: any = null;

    try {
      const scheduleUrl = new URL("/api/booking-schedule", origin);
      const response = await fetch(scheduleUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, postcode, bins }),
      });
      schedule = await response.json().catch(() => ({}));
      schedule.httpStatus = response.status;
    } catch (error) {
      schedule = {
        matched: false,
        reason: "booking_schedule_lookup_failed",
        error: error instanceof Error ? error.message : "lookup_failed",
      };
    }

    console.info("[round-audit] council-aware proposed schedule", {
      address,
      postcode,
      schedule,
    });

    try {
      const auditUrl = new URL("/.netlify/functions/sendRoundAuditEmail", origin);
      await fetch(auditUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload?.name || "",
          address,
          postcode,
          schedule,
        }),
      });
    } catch (error) {
      console.warn("[round-audit] audit email failed", error instanceof Error ? error.message : error);
    }
  } catch (error) {
    console.warn("[round-audit] middleware error", error instanceof Error ? error.message : error);
  }

  return context.next();
};

export const config: Config = {
  path: "/.netlify/functions/sendBookingEmail",
  method: ["POST"],
  onError: "bypass",
};
