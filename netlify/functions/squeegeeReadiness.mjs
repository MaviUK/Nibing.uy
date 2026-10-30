// Temporary preview-only, read-only Squeegee connectivity check.
// It returns neither the API key nor customer/service/round identities.
// Delete this function after verifying that the integration is connected.
import squeegee from "./lib/squeegeeApiV3.js";

const PREVIEW_HOST = "deploy-preview-77--nibinguy.netlify.app";
const PREVIEW_BRANCH = "preview/n64-retro-site";
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const reply = (status, data) => new Response(JSON.stringify(data), {
  status, headers: HEADERS,
});

export default async function handler(request, context) {
  const host = new URL(request.url).hostname;
  // Netlify does not supply BRANCH in deployed Functions runtime. The
  // exact Preview 1 hostname plus Netlify's verified deploy context, together
  // with the branch-scoped secret value, keep this diagnostic isolated.
  const guard = {
    hostMatch: host === PREVIEW_HOST,
    deployContext: context?.deploy?.context || null,
  };
  if (!guard.hostMatch || guard.deployContext !== "deploy-preview") {
    return reply(404, { error: "Not found" });
  }
  if (request.method !== "GET") {
    return reply(405, { error: "Method not allowed" });
  }

  // The Netlify encrypted variable must be available at Functions runtime.
  const apiKey = Netlify.env.get("SQUEEGEE_API_KEY");
  if (!apiKey) {
    return reply(503, { connected: false, reason: "key_unavailable_for_preview" });
  }

  // Only documented GET requests. Never request customer details or write jobs.
  const [services, groups, customers] = await Promise.allSettled([
    squeegee.getServices(),
    squeegee.getJobGroups(),
    squeegee.listCustomers({ page: 1 }),
  ]);
  const safeLabel = (value) => String(value || "")
    .replace(/[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}/g, "[email redacted]")
    .replace(/\\b(?:\\+?44|0)\\d[\\d\\s-]{8,}\\b/g, "[phone redacted]")
    .replace(/\\bBT\\d{1,2}\\s*\\d[A-Z]{2}\\b/gi, "[postcode redacted]")
    .replace(/[<>]/g, "").trim().slice(0, 90);
  const summary = (result) => {
    if (result.status === "fulfilled") {
      const rows = Array.isArray(result.value) ? result.value : [];
      return {
        connected: true,
        count: rows.length,
        // One-time, preview-only diagnostic. No UUIDs, customers, or credentials.
        descriptions: rows.slice(0, 30).map((row) => safeLabel(row?.description)),
      };
    }
    return {
      connected: false,
      status: result.reason?.status || null,
    };
  };
  const servicesStatus = summary(services);
  const groupsStatus = summary(groups);
  // Probe schema only: absolutely no names, contact details, addresses,
  // emails, UUIDs, customer counts or records are returned.
  let customerSchema;
  if (customers.status === "fulfilled") {
    const value = customers.value;
    const rootKeys = value && !Array.isArray(value) && typeof value === "object"
      ? Object.keys(value).slice(0, 30) : [];
    const arrays = (Array.isArray(value) ? [{ key: "(root)", rows: value }] :
      Object.entries(value || {}).filter(([, v]) => Array.isArray(v))
        .map(([key, rows]) => ({ key, rows })));
    customerSchema = {
      connected: true,
      rootType: Array.isArray(value) ? "array" : typeof value,
      rootKeys,
      arrayFields: arrays.map(({ key, rows }) => ({
        key,
        firstItemKeys: rows[0] && typeof rows[0] === "object"
          ? Object.keys(rows[0]).slice(0, 40) : [],
      })),
    };
  } else {
    customerSchema = {
      connected: false,
      status: customers.reason?.status || null,
    };
  }

  const connected = servicesStatus.connected && groupsStatus.connected;
  return reply(connected ? 200 : 502, {
    connected,
    readOnly: true,
    previewBranch: PREVIEW_BRANCH,
    services: servicesStatus,
    jobGroups: groupsStatus,
    customersSchema: customerSchema,
  });
}

export const config = {
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "domain",
    windowSize: 60,
    windowLimit: 3,
  },
};
