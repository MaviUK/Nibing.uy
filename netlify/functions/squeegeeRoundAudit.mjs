// One-time Preview 1 diagnostics. GET only; returns anonymous aggregate counts.
// No customer names, addresses, postcodes, IDs, phones, emails, or job IDs.
import squeegee from "./lib/squeegeeApiV3.js";
import analyzer from "./lib/squeegeeRoundAnalysis.js";

const PREVIEW_HOST = "deploy-preview-77--nibinguy.netlify.app";
const json = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

export default async function handler(request, context) {
  const url = new URL(request.url);
  if (url.hostname !== PREVIEW_HOST ||
      context?.deploy?.context !== "deploy-preview" ||
      request.method !== "GET") {
    return json(404, { error: "Not found" });
  }
  if (!process.env.SQUEEGEE_API_KEY) {
    return json(503, { error: "Preview-only Squeegee key unavailable" });
  }

  const maxPages = 12;
  const rows = [];
  let pagedRequestId;
  let complete = false;
  let lastPage = 0;
  let groupList;
  try {
    groupList = await squeegee.getJobGroups();
    if (!Array.isArray(groupList)) throw new Error("Unexpected group response");

    for (let page = 1; page <= maxPages; page++) {
      const data = await squeegee.listCustomers({ page, pagedRequestId });
      if (!data || !Array.isArray(data.customers) || typeof data.hasMore !== "boolean") {
        throw new Error("Unexpected customer page shape");
      }
      rows.push(...data.customers);
      lastPage = page;
      if (!data.hasMore) { complete = true; break; }
      if (typeof data.pagedRequestId === "string" && data.pagedRequestId) {
        pagedRequestId = data.pagedRequestId;
      }
      await new Promise(resolve => setTimeout(resolve, 260));
    }

    const result = analyzer.analyzeSqueegeeTownGroups(groupList, rows, {
      minCell: 5,
      minDominant: 10,
      minShare: 0.85,
    });
    return json(200, {
      ...result,
      pagesRead: lastPage,
      pagesComplete: complete,
      snapshotTruncated: !complete,
      advisoryOnly: true,
      note: "Town association is not verified round weekday/date mapping",
    });
  } catch {
    // Never expose upstream errors or accidentally log customer records.
    return json(502, {
      error: "Read-only mapping check unsuccessful",
      pagesRead: lastPage,
    });
  }
}
