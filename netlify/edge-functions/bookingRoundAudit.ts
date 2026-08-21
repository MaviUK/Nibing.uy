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

    if (!address || !postcode || !bins.length) return context.next();

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

    const automatic = Boolean(
      schedule?.matched &&
      Array.isArray(schedule?.results) &&
      schedule.results.length > 0 &&
      schedule.results.every((result: any) => result?.automatic && result?.assignedCleanDate)
    );

    console.info("[round-audit] council-aware proposed schedule", {
      address,
      postcode,
      automatic,
      schedule,
    });

    if (automatic) {
      const confirmationUrl = new URL("/.netlify/functions/sendAutomaticBookingConfirmation", origin);
      const confirmation = await fetch(confirmationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, schedule }),
      });

      if (confirmation.ok) {
        return new Response(await confirmation.text(), {
          status: confirmation.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      console.warn("[round-audit] automatic confirmation failed; falling back to existing booking flow", confirmation.status);
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
