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
    const checks = await Promise.all(
      bins.map(async (bin: any) => {
        const url = new URL("/api/round-lookup", origin);
        url.searchParams.set("postcode", postcode);
        url.searchParams.set("address", address);
        url.searchParams.set("bin", String(bin.type || ""));

        try {
          const response = await fetch(url);
          const data = await response.json().catch(() => ({}));
          return {
            requestedBin: bin.type,
            status: response.status,
            ...data,
          };
        } catch (error) {
          return {
            requestedBin: bin.type,
            status: 0,
            error: error instanceof Error ? error.message : "lookup_failed",
          };
        }
      })
    );

    console.info("[round-audit] booking proposed schedule", {
      address,
      postcode,
      checks,
    });
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
