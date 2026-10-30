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
  const runtimeBranch = process.env.BRANCH || Netlify.env.get("BRANCH") || "";
  const guard = {
    hostMatch: host === PREVIEW_HOST,
    deployContext: context?.deploy?.context || null,
    branchPresent: Boolean(runtimeBranch),
    branchMatch: runtimeBranch === PREVIEW_BRANCH,
  };
  if (!guard.hostMatch || guard.deployContext !== "deploy-preview" || !guard.branchMatch) {
    // Diagnostic booleans only; no credential or customer data is returned.
    return reply(404, { error: "Preview guard failed", checks: guard });
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
  const [services, groups] = await Promise.allSettled([
    squeegee.getServices(),
    squeegee.getJobGroups(),
  ]);
  const summary = (result) => {
    if (result.status === "fulfilled") {
      return { connected: true, count: Array.isArray(result.value) ? result.value.length : null };
    }
    return {
      connected: false,
      // Status only; never return upstream content, identifiers or credentials.
      status: result.reason?.status || null,
    };
  };
  const servicesStatus = summary(services);
  const groupsStatus = summary(groups);
  const connected = servicesStatus.connected && groupsStatus.connected;

  return reply(connected ? 200 : 502, {
    connected,
    readOnly: true,
    previewBranch: PREVIEW_BRANCH,
    services: servicesStatus,
    jobGroups: groupsStatus,
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
