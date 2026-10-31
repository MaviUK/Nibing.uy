// Owner-only, read-only historical leaderboard preview on Preview 1 (PR #77).
// Does not save raw exports, change scores, or make ANY Squeegee write.
import api from "./lib/squeegeeApiV3.js";
import owner from "./lib/squeegeePreviewTestSession.js";
import score from "./lib/squeegeeHistoricalLeaderboard.js";
import { gunzipSync } from "node:zlib";

const PATH = "/api/squeegee-preview-leaderboard-history";
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex,nofollow,noarchive",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const safe = value => String(value ?? "").replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const page = (content, status = 200) => new Response(
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>NI Bin Guy - History points preview</title>' +
  '<style>body{margin:0;padding:16px;background:#111422;color:#fafafa;font:16px/1.5 system-ui,sans-serif}' +
  'main{max-width:620px;margin:16px auto;padding:20px;border:2px solid #f3d750;background:#232838}' +
  'h1{font-size:27px;line-height:1.12}h2{font-size:20px}strong{color:#f3d750}' +
  'a{color:#f3d750}section{padding:12px;margin:16px 0;background:#343a4d}' +
  'button,input{display:block;box-sizing:border-box;width:100%;padding:12px;font:inherit;margin:12px 0}' +
  'button{background:#f3d750;border:2px solid #111;font-weight:800;color:#151515}' +
  'input{background:white;color:#111;border:2px solid #f3d750}' +
  'small{color:#c7cddd}code{overflow-wrap:anywhere}</style></head><body><main>' +
  '<h1>NI Bin Guy - Historical leaderboard</h1>' + content +
  '<p><small>Owner-only Preview 1 tool. No public XP, Squeegee jobs, invoices, customers or payments are changed here.</small></p>' +
  '</main></body></html>', { status, headers: HEADERS });

function scopeFrom(request, context) {
  return {
    hostname: new URL(request.url).hostname,
    deployContext: context?.deploy?.context,
    siteId: context?.site?.id,
  };
}

export default async function handler(request, context) {
  const scope = scopeFrom(request, context);
  if (!api.isExactPreview1(process.env, scope)) return new Response("Not found", { status: 404 });
  if (!["GET", "POST"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  const cookie = owner.sessionCookieFromHeader(request.headers.get("cookie"));
  if (!owner.verifyTestSessionCookie(cookie, process.env, Date.now(), scope)) {
    if (request.method === "POST") return page("<p>Owner session expired. No file was processed.</p>", 403);
    return page('<section><strong>Owner sign-in required.</strong>' +
      '<p>Use your existing emailed Squeegee owner code to open the history preview.</p></section>' +
      '<a href="/api/squeegee-preview-test?returnTo=' + encodeURIComponent(PATH) + '">Sign in with owner code</a>', 403);
  }

  if (request.method === "POST") {
    // Preview only: browser-submitted normalized JSON, no ingestion into storage.
    // Avoid storing, echoing or logging customer identifying data from uploads.
    try {
      const form = await request.formData();
      const file = form.get("history");
      if (!file || typeof file.text !== "function" || file.size > 2_000_000 || file.size < 2)
        return page("<section>Choose one normalized JSON or compressed .json.gz file of up to 2 MB.</section>", 400);
      // The complete 2024-2026 backup is 10 MB of normalized JSON, but only
      // 1.84 MB as gzip. Bound decompression to prevent oversized uploads.
      const content = Buffer.from(await file.arrayBuffer());
      const isGzip = typeof file.name === "string" && /\.json\.gz$/i.test(file.name);
      const json = isGzip ? gunzipSync(content, { maxOutputLength: 12_000_000 })
        .toString("utf8") : content.toString("utf8");
      const data = JSON.parse(json);
      const asOf = new Date().toISOString().slice(0, 10);
      const result = score.calculateHistoricalScores({ ...data, asOf });
      const held = result.totals.heldCleans;
      return page('<section><strong>DRY RUN COMPLETE - no public scores changed</strong>' +
        '<p>Paid completed cleans: <strong>' + result.totals.paidCleans + '</strong></p>' +
        '<p>Historical penalty days: <strong>' + result.totals.overdueDays + '</strong></p>' +
        '<p>Cleans requiring manual review: <strong>' + held + '</strong></p>' +
        '<p>Customer records assessed: <strong>' + result.customers.length + '</strong></p>' +
        '<p>Rejected/invalid rows: <strong>' +
          (result.issues.invalidInvoices + result.issues.invalidCleans) + '</strong></p>' +
        '<p>Conflicting IDs: <strong>' +
          (result.issues.invalidInvoicesConflicts + result.issues.invalidCleansConflicts) + '</strong></p>' +
        '<p>Audit fingerprint: <code>' + result.fingerprint + '</code></p></section>' +
        '<p>No data was persisted. <a href="' + PATH + '">Return to preview</a></p>');
    } catch (_) {
      return page('<section>Could not validate file. Use the canonical JSON layout described below, ' +
        'with fully verified clean and payment dates. No changes made.</section>' +
        '<p><a href="' + PATH + '">Try again</a></p>', 400);
    }
  }

  let probe = "";
  if (new URL(request.url).searchParams.get("probe") === "1") {
    try {
      const listing = await api.listCustomers({ page: 1 });
      const count = Array.isArray(listing?.customers) ? listing.customers.length : null;
      probe = '<section><strong>Squeegee read-only connection: ' + (count === null ? "UNKNOWN" : "OK") + '</strong>' +
        '<p>Customer records returned on the first page: ' + (count ?? "unavailable") + '</p>' +
        '<p>More pages: ' + (listing?.hasMore === true ? "Yes" : "No or unverified") + '</p>' +
        '<p>No invoice settlement dates have been verified from the documented API endpoints. ' +
        'This check does not retrieve payment history.</p></section>';
    } catch (_) {
      probe = '<section>Read-only customer check unavailable. No Squeegee changes were attempted.</section>';
    }
  }
  return page('<section><strong>Stage 1: score engine ready (DRY RUN only)</strong>' +
    '<p>1 point per completed, fully paid bin clean. After a 28-day grace period, ' +
    '1 point is deducted per day with any verified overdue invoice, even if several are overdue. ' +
    'Historical deductions stop when the invoice was fully settled.</p>' +
    '<p>No existing customers will be published by this preview; historical balances need reconciliation first.</p></section>' +
    '<p><a href="' + PATH + '?probe=1">Check Squeegee customer API (READ ONLY)</a></p>' + probe +
    '<h2>History import dry run</h2>' +
    '<p>This accepts a <strong>normalized JSON or .json.gz</strong> file, not a raw Squeegee CSV. ' +
    'First export Job and Financial/Payments reports from Squeegee, then confirm column headings ' +
    'so we can map them without guessing.</p>' +
    '<form method="post" enctype="multipart/form-data" action="' + PATH + '">' +
    '<label for="history">Normalized history JSON or JSON.gz (max 2 MB)</label>' +
    '<input type="file" id="history" name="history" accept=".json,.gz,application/json,application/gzip" required>' +
    '<button type="submit">CALCULATE POINTS - NO CHANGES</button></form>' +
    '<section><small>Required layout: <code>{"cleans":[{"customerId":"...",' +
      '"cleanId":"...","invoiceId":"...","completedOn":"YYYY-MM-DD",' +
      '"kind":"bin-clean","status":"completed"}],"invoices":[{"customerId":"...",' +
      '"invoiceId":"...","dueOn":"YYYY-MM-DD","state":"settled","paidOn":"YYYY-MM-DD"}]}</code>.' +
      ' For open invoices provide <code>state:"open"</code> and a verified positive ' +
      '<code>outstandingPence</code>. Omit personal names, emails and phone numbers.</small></section>');
}

export const config = {
  path: "/api/squeegee-preview-leaderboard-history",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 8 },
};
