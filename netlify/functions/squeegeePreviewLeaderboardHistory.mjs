// Owner-only, read-only historical leaderboard preview on Preview 1 (PR #77).
// Does not save raw exports, change scores, or make ANY Squeegee write.
import api from "./lib/squeegeeApiV3.js";
import owner from "./lib/squeegeePreviewTestSession.js";
import score from "./lib/squeegeeHistoricalLeaderboard.js";
import { gunzipSync } from "node:zlib";
import { getStore } from "@netlify/blobs";
import active from "./lib/squeegeeActiveLeaderboardImport.js";
import publicSeed from "./lib/squeegeeActivePreviewSnapshot.js";

const PATH = "/api/squeegee-preview-leaderboard-history";
const ACTIVE_STATUS="n64-preview1-squeegee-active-only";
const activeStore=()=>getStore({name:ACTIVE_STATUS,consistency:"strong"});
async function currentActiveSnapshots() {
  const store=activeStore();
  const [staged,published,mode]=await Promise.all([
    store.get(active.SNAPSHOT_KEY,{type:"json",consistency:"strong"}),
    store.get(active.PUBLISHED_KEY,{type:"json",consistency:"strong"}),
    store.get(active.MODE_KEY,{type:"json",consistency:"strong"}),
  ]);
  return {staged,published,mode};
}
function activeSection({staged,published,mode}={}) {
  const snapshot=staged||published||null;
  const publicPreview=publicSeed.getHistoricalSnapshot();
  const preloaded=publicPreview.totalPlayers>0 && mode?.activeOnly!==true;
  const list=snapshot?active.combinedPublicBoard(snapshot):null;
  const summary=snapshot?.summary;
  const identical=Boolean(staged && published && staged.sourceHash===published.sourceHash);
  const state=published
    ? (identical?"PUBLISHED ON PREVIEW 1":"NEW IMPORT STAGED — PREVIOUS APPROVED SNAPSHOT STILL LIVE")
    : (staged?"STAGED FOR OWNER REVIEW":(mode?.activeOnly===true?"HIDDEN BY OWNER":"NOT IMPORTED"));
  const table=list?.entries?.map(e=>
    "<li><strong>"+safe(e.customerRef)+"</strong> · "+safe(e.town)+
    " · "+String(e.points)+" XP</li>").join("")||"";
  const approved=published && active.snapshotIsFresh(published);
  return '<section><h2>Active-only Squeegee leaderboard</h2>'+
    '<p><strong>'+(!snapshot&&preloaded?"PRELOADED PUBLIC PREVIEW (active-only)":state)+'</strong></p>'+
    (!snapshot && preloaded?
      '<p>Preloaded reference/town/paid-clean snapshot: <strong>'+publicPreview.totalPlayers+
      ' active customers</strong>, dated '+safe(publicSeed.AS_OF)+
      '. No private Squeegee account IDs are stored in the preview source.'+
      ' Customer names, contact details and overdue-payment flags are excluded.</p>':'')+
    (summary?'<p>Active accounts: '+summary.activeAccounts+
      ' · Ranked: '+summary.publishedCandidates+
      ' · Paid-clean points: '+summary.historicalPaidPoints+
      ' · Town review: '+summary.heldTown+
      ' · No verified paid cleans: '+summary.zeroPoints+'</p>'+
      '<p>Source backup: '+safe(snapshot.asOf)+'. '+
      (approved?'Public preview is enabled.':'Historical scores are not publicly served.')+
      '</p><ol>'+table+'</ol>':
      '<p>Import the private active-only mapping prepared from your Squeegee backup. The import stores only a private UUID-to-reference/town/points mapping, not names, emails, addresses, or the raw CSV.</p>')+
    '<form method="post" enctype="multipart/form-data" action="'+PATH+'">'+
    '<input type="hidden" name="action" value="active-import">'+
    '<label for="activeMapping">Active Squeegee customer mapping CSV (max 250 KB)</label>'+
    '<input id="activeMapping" name="activeMapping" type="file" accept=".csv,text/csv" required>'+
    '<label for="asOf">Squeegee backup date</label>'+
    '<input id="asOf" name="asOf" type="date" value="2026-10-31" required>'+
    '<button type="submit">IMPORT ACTIVE CUSTOMERS - PRIVATE REVIEW</button></form>'+
    (staged?
      '<form method="post" action="'+PATH+'">'+
      '<input type="hidden" name="action" value="publish-active">'+
      '<label><input type="checkbox" name="privacyConfirmed" value="yes" required> '+
      'I confirm suitable customer privacy information and participation controls are in place, and I have reviewed this active-only snapshot.</label>'+
      '<button type="submit">PUBLISH ON N64 PREVIEW ONLY</button></form>':'')+
    ((published||preloaded)?
      '<form method="post" action="'+PATH+'">'+
      '<input type="hidden" name="action" value="unpublish-active">'+
      '<button type="submit">HIDE HISTORICAL LEADERBOARD</button></form>':'')+
    '<p><small>Preview 1 only. A later owner-uploaded private CSV is always staged for review before it replaces this preloaded public preview. Historical overdue deductions are excluded. Use HIDE to remove the dated public ranking immediately.</small></p></section>';
}
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
  'input[type=checkbox]{display:inline-block;width:20px;height:20px;vertical-align:middle;margin:0 6px 0 0}' +
  'small{color:#c7cddd}code{overflow-wrap:anywhere}</style></head><body><main>' +
  '<h1>NI Bin Guy - Historical leaderboard</h1>' + content +
  '<p><small>Owner-only Preview 1 tool. Squeegee records remain untouched. Historical leaderboard visibility requires a separate explicit publish action.</small></p>' +
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
      const action=String(form.get("action")||"dryrun");
      if(["active-import","publish-active","unpublish-active"].includes(action)) {
        // An authenticated owner must submit from this exact preview origin.
        if(request.headers.get("origin")!=="https://deploy-preview-77--nibinguy.netlify.app")
          return page("<section>Cross-site import blocked. No changes made.</section>",403);
        const store=activeStore();
        if(action==="active-import"){
          const file=form.get("activeMapping");
          if(!file || typeof file.text!=="function" || file.size<20 ||
             file.size>active.MAX_CSV_BYTES)
            return page("<section>Choose the private active-only mapping CSV (max 250 KB).</section>",400);
          const source=await file.text();
          const snapshot=active.normalizeActiveImport(source,{
            asOf:String(form.get("asOf")||""),
          });
          const previous=await store.get(active.SNAPSHOT_KEY,{type:"json",consistency:"strong"});
          if(previous?.asOf && snapshot.asOf<previous.asOf)
            return page("<section>Older backups cannot replace a newer import.</section>",409);
          if(previous?.asOf===snapshot.asOf && previous.sourceHash===snapshot.sourceHash)
            return page('<section><strong>ALREADY IMPORTED — no duplicate XP.</strong>'+
              '<p>The same file and backup date were previously stored.</p></section>'+
              '<p><a href="'+PATH+'">Review leaderboard</a></p>');
          const saved=await store.setJSON(active.SNAPSHOT_KEY,snapshot);
          if(saved?.modified!==true)
            return page("<section>Import was not saved. No public changes made.</section>",503);
          return page('<section><strong>ACTIVE-ONLY IMPORT SAVED — PRIVATE REVIEW</strong>'+
            '<p>Active accounts: '+snapshot.summary.activeAccounts+
            ' · Eligible: '+snapshot.summary.publishedCandidates+
            ' · Paid-clean points: '+snapshot.summary.historicalPaidPoints+
            ' · Held for town review: '+snapshot.summary.heldTown+'</p>'+
            '<p>No score was added to the public board. No customer details were logged or sent to GitHub.</p>'+
            '</section><p><a href="'+PATH+'">Review top scores and publication control</a></p>');
        }
        if(action==="unpublish-active"){
          // The active-only safety latch remains in place. The public GET
          // cannot fall back to unverified website-only player accounts.
          await store.setJSON(active.MODE_KEY,{activeOnly:true,updatedAt:new Date().toISOString()});
          await store.delete(active.PUBLISHED_KEY);
          return page('<section><strong>HISTORICAL LEADERBOARD HIDDEN</strong>'+
            '<p>Private points are retained. No customer data was deleted.</p></section>'+
            '<p><a href="'+PATH+'">Return to owner leaderboard</a></p>');
        }
        const state=await store.getWithMetadata(active.SNAPSHOT_KEY,{type:"json",consistency:"strong"});
        const current=state?.data;
        if(!current || state?.etag===undefined)
          return page("<section>Import the active-only mapping first.</section>",409);
        if(action==="publish-active" && (
          form.get("privacyConfirmed")!=="yes" ||
          !active.snapshotIsFresh(current)))
          return page("<section>Privacy confirmation and a recent account-status backup are required before publishing.</section>",409);
        if(action==="publish-active" && active.eligibleHistoricalEntries(current).length===0)
          return page("<section>There are no eligible active customers.</section>",409);
        const latest=await store.getMetadata(active.SNAPSHOT_KEY,{consistency:"strong"});
        if(!latest || latest.etag!==state.etag)
          return page("<section>Import changed during review. Refresh before publishing.</section>",409);
        const next={...current,published:true,publishedAt:new Date().toISOString()};
        // Never briefly fall back to unverified player accounts while an
        // active-only snapshot is being swapped or un-published.
        await store.setJSON(active.MODE_KEY,{
          activeOnly:true,updatedAt:new Date().toISOString()
        });
        const saved=await store.setJSON(active.PUBLISHED_KEY,next);
        if(saved?.modified!==true)
          return page("<section>Publish was not saved. Private data is intact.</section>",503);
        return page('<section><strong>PUBLISHED TO PREVIEW 1</strong>'+
          '<p>Only active, non-deleted accounts with verified towns are ranked. '+
          'No customer names, UUIDs, invoices or payment details are public.</p></section>'+
          '<p><a href="'+PATH+'">Return to owner leaderboard</a></p>');
      }
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
  let activePreview="";
  try { activePreview=activeSection(await currentActiveSnapshots()); }
  catch { activePreview="<section>Active leaderboard storage is temporarily unavailable.</section>"; }
  return page(activePreview + '<section><strong>Historical score calculator (dry run)</strong>' +
    '<p>1 point per completed, fully paid bin clean. After a 28-day grace period, ' +
    '1 point is deducted per day with any verified overdue invoice, even if several are overdue. ' +
    'Historical deductions stop when the invoice was fully settled.</p>' +
    '<p>Historical overdue deductions are not included in the active-only leaderboard.</p></section>' +
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
