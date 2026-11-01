# NI Bin Guy - historical Squeegee leaderboard (Preview 1 only)

Status: **Stage 1 implemented, DRY RUN / READ ONLY.** No changes to public
leaderboard scores, Production, Preview 2, customer records or Squeegee jobs.

## What is built

- Pure deterministic scoring engine:
  netlify/functions/lib/squeegeeHistoricalLeaderboard.js
- Regression tests:
  tests/squeegee-historical-leaderboard.test.cjs
- Owner-only, Preview 1 function:
  /api/squeegee-preview-leaderboard-history
- The page uses the existing emailed Preview 1 owner access-code session.
  Its "Check Squeegee customer API" action makes only one authenticated GET
  for page 1 of customers, returns counts, and discards customer records.
- The owner page can calculate an **in-memory dry run** from verified,
  normalized JSON (maximum 2 MB). The upload and results are not stored.
  It does not write to Squeegee or Netlify Blobs.

## Scoring policy (for review)

- +1 point for each **completed bin-clean appointment** with a confirmed,
  fully settled, linked invoice, regardless of how many bins were in that
  single appointment. Repeat invoice payments do not give repeat points.
- No paid-clean points for an outstanding/part-paid/unknown/disputed/void
  invoice. Such completed jobs are held for review.
- Grace period: first **28 whole calendar days after invoice DUE date**
  (not booking date or cleaning date) incur no deduction. One point is
  deducted on day 29 and each later overdue day until paid in full.
- A customer can lose at most 1 overdue point on any calendar day even with
  multiple overlapping overdue invoices. Separate periods are counted.
- Historical late-payment deductions remain in the ledger after settlement,
  but stop accruing from the full-settlement date.
- Invalid dates, conflicting job/invoice IDs, customer mismatches and
  unsupported service types are held rather than guessed.
- If a verified payment has no trustworthy due date, the paid clean can earn
  a point but no retroactive late-payment penalty can be inferred.
- Scores may be negative internally; no public-score application is enabled.

## Input required to import real history

The documented Squeegee API v3 currently integrated by NI Bin Guy exposes
customer, job template, service and job-group endpoints, **not verified
historical paid-invoice allocations and settlement timestamps**.

Squeegee supports report exports. Owner should inspect, without sending
customer data publicly:

1. Squeegee > Reports > Job reports: look for completed **appointment**
   identifier, customer Squeegee ID, service/colour, completion date, and
   related invoice ID. Recurring job template ID is not an appointment.
2. Squeegee > Reports > Financial reports: look for invoice ID, customer ID,
   due date, payment dates/allocations, final settled date, balance, and
   statuses (void, refund, write-off, credit note, disputed).
3. If these cannot be matched by invoice ID/job ID, **do not infer** payment
   status from an overall customer balance. Investigate alternative report,
   backup, or request the missing read-only API endpoint from Squeegee.

Squeegee publicly documents report categories and backup exports:
https://squeeg.ee/docs/video/reporting/viewing-and-downloading-reports
https://squeeg.ee/docs/frequently-asked-questions/manage-data

## Canonical (anonymised) dry-run JSON shape

Each identifier below must be a stable Squeegee identifier; fabricated or
sequence-based IDs are not accepted for live use.

{
  "cleans": [
    {
      "customerId": "customer-1",
      "cleanId": "appointment-1",
      "invoiceId": "invoice-1",
      "completedOn": "2026-09-01",
      "kind": "bin-clean",
      "status": "completed"
    }
  ],
  "invoices": [
    {
      "customerId": "customer-1",
      "invoiceId": "invoice-1",
      "dueOn": "2026-09-08",
      "state": "settled",
      "paidOn": "2026-09-09"
    }
  ]
}

For a verified outstanding/partially paid invoice, set state to "open",
omit paidOn, and include outstandingPence as a positive integer. Settled
invoices must use the full payment date (not the first partial payment date).
Use "excluded" for void/refunded/non-billable invoices and "unknown" for
financial information requiring review.

Remove names, email addresses, phone numbers, addresses, bank details and
payment references from dry-run files. We need only IDs and dates.

## Not yet done: publication / automation

- Map real Squeegee report formats to these normalized fields; inspect actual
  headings, not guessed property names.
- Validate complete pagination, appointment vs recurring-job distinction,
  payment allocation and credit/refund handling.
- Stage an idempotent, versioned **private** per-customer ledger with an audit
  trail and transactional updates before daily synchronization.
- Link Squeegee customer IDs to existing arcade players using verified identity
  and address, not an email-only match. Avoid merging customers at different
  properties accidentally.
- Do not publicly list identifiable existing customers until they have been
  notified and permitted a private/opt-out choice. Do not display debt,
  invoice status or financial details on the public leaderboard.
- Review the preview calculated historical rewards and potential penalties
  before any activation. Never run Squeegee POSTs from this feature.
- Merge/deploy to Production requires explicit owner approval.

## 1 November 2026 — ACTIVE SQUEEGEE ACCOUNTS ONLY (owner decision)

The public NI Bin Guy leaderboard must include **only** a customer whose **current** Squeegee account state is exactly `active` and whose record is **not deleted**. Customers with `inactive`, `deactivated`, `prospect`, unknown status, or deleted/archived status must be **excluded from public ranking**, even if their historical cleans were paid. Do not discard their private historical points; a later, verified reactivation may make those points eligible again. Deactivation must remove a previously visible customer on the next verified status sync. An absent, ambiguous or stale account status is not evidence of activation: fail closed until verified. Never publish debt/payment status.

The **31 October 2026 Squeegee backup** is a historical status snapshot, not live confirmation. Verified counts: 1,022 active/non-deleted customer records; 950 had verified paid cleans; 941 of those had a confirmed town and were prepared in the active-only *preview* CSV; nine active paid-clean customers need town verification; 72 active customers have no eligible paid-clean points yet. The other 8,448 historical customer records (including deleted records, even when marked active) are excluded from the active-only mapping. This was initially a dry-run set; see the November 1 Preview 1 preloaded-public-snapshot update below. Late-payment deductions remain held.

Source outputs are private local artefacts: `NI_Bin_Guy_Leaderboard_ACTIVE_ONLY_2026-10-31.zip` and `NI_Bin_Guy_Leaderboard_ACTIVE_ONLY_PREVIEW.csv`. Do NOT commit customer-level CSV, Squeegee IDs or backups to GitHub. Legacy customers **do not need website IDs**. Later join their private Squeegee UUID to website XP only on verified matches, preserving both balances and preventing duplicate points. The existing website-only arcade enrolment cannot yet guarantee Squeegee status; before combining and publishing historical/Squeegee-derived ranks, the live status-gated join must be implemented and tested separately. Preserve current Preview 1 website scores, bookings and Production while developing this. Provide suitable customer privacy information/participation controls before public publishing.


## 1 November 2026 — Active-only historical leaderboard implementation (Preview 1)

The owner-provided 31 October 2026 active-only Squeegee mapping is **1,022 active/non-deleted UUIDs**. Of these, 941 have verified town and positive paid-clean points (20,778 total); nine have eligible points but a town needing review; 72 have no verified paid cleans. The owner-approved public display shape contains only \`customerRef\`, \`town\`, \`points\`. No real Squeegee customer reference, invoice status or name is exposed.

### Components

- \`netlify/functions/lib/squeegeeActiveLeaderboardImport.js\` parses and validates the **PRIVATE** \`NI_Bin_Guy_Active_Squeegee_Customer_Mapping_PRIVATE.csv\` (not the public-compatible three-column CSV). It insists on exact active and non-deleted states, validates the UUID-derived public pseudonym, refuses duplicated or malformed identifiers, reviews unknown towns and caps file size.
- Existing owner-authenticated \`/api/squeegee-preview-leaderboard-history\` (Preview 1 only) has an **Import active customers — private review** form; upload the PRIVATE mapping CSV once and enter its actual Squeegee backup date (initially 2026-10-31). A new upload stages a replacement privately without changing the last published active-only snapshot. The replacement becomes public only after an explicit owner approval. Repeating the same file/date is a no-op. Source CSV bytes are **not** retained; normalized private UUID/reference/town/paidClean tuples go to the dedicated preview-only Netlify Blob store \`n64-preview1-squeegee-active-only\`. Do not upload the customer mapping to GitHub, Netlify Forms, or the public site.
- The same owner page displays a private top ten and a **separate publish button**. Staged and published snapshots are separate Blob keys, so an unreviewed weekly update cannot alter public scores. The publish action requires an active owner OTP session, same-origin form POST, a checked privacy/participation control declaration, and a source snapshot within seven days. It can be un-published immediately using the same owner page. Once the active-only mode has been enabled, un-publishing empties the historical public board rather than restoring unverified website-only names/players.
- \`arcadeLeaderboard.js\` uses an embedded, **publicly displayable pseudonymous historical snapshot** on the exact N64 Preview 1 host when there is no owner-uploaded, approved private mapping. The owner can override it with a reviewed private import or hide it via the active-only mode latch. Existing website-only profiles without a verified Squeegee customer remain unranked while their XP records are preserved. A stale active-status snapshot hides history; it is **not** a fresh Squeegee API check.
- \`netlify/functions/lib/arcadeSqueegeeLink.js\` can link website XP to the real immutable Squeegee UUID *only after a Squeegee job is confirmed successful* and the enrolled player's exact name, email and service property match the accepted booking. The link stores only verified UUID and email-derived private player key in a separate preview store, with an atomic create-if-new guard. Multiple website bookings with one email, conflicts, and unidentified customers are held rather than merged. This link is performed by the existing preview-only booking worker as a best-effort side effect after job claims succeed; no booking or Squeegee job is retried due to linkage failures.
- Public leaderboard scoring is **historical paid completed cleans (+1 each) plus existing website XP only after verified UUID linkage**. The historical-overdue deduction is **NOT** applied. A customer counts once even if both sources exist. The public API uses an explicit reference/town/points allowlist; it never returns UUIDs or payment details.
- Existing website still has only a Top 10 board, but all 941 approved historical candidates participate in ranking. A separate self-contained owner HTML preview for the 941 entries is available as a local ChatGPT artifact, not committed to GitHub.

### Safety and outstanding verification

Do not merge this PR into production or upload raw customer spreadsheets to GitHub. The feature is Preview 1 only. A **sanitized, embedded 941-entry public snapshot** is now in the preview code, so **no owner upload is needed to see historical top ten rankings in Preview 1**. The private UUID-to-website player mapping has **not** been bulk-uploaded to Netlify; it is separate and optional for future revisions. The standalone HTML preview remains independent of website storage. The user must review privacy notices/lawful basis and arrange suitable participation controls before publicly exposing pseudonymous customer data; a town/reference pair may still be personal data. The backup's active status is historical: there is no live status refresh yet. The seven-day fail-closed policy prevents indefinite publication of stale accounts. A future read-only Squeegee customer-status sync can automatically hide deactivated entries without requiring payment-history API endpoints. Payment-history API access is still required for automatic paid-clean point updates.


### 1 November 2026 — 941 active accounts prepopulated in N64 Preview 1

The owner asked that the leaderboard actually be populated, with **only active, non-deleted Squeegee customers**. Verified from the owner-provided 31 October backup: all 941 publicly ranked entries correspond to distinct active/non-deleted Squeegee UUIDs, contain towns and eligible paid-clean points, sum to 20,778, and span 11 towns. The 9 otherwise eligible but unknown-town accounts and 72 active zero-history accounts are not ranked. No inactive/archived/deleted customer is included.

- \`netlify/functions/lib/squeegeeActivePreviewSnapshot.js\` is generated from the three-column *pseudonymous* preview CSV. It embeds **only** generated NBG public references, checked town labels and paid-clean XP (no Squeegee UUID, actual Squeegee customer reference, private name, email, address, postcode, invoices or payment dates). The source file is committed to the preview branch, not Production.
- \`netlify/functions/lib/squeegeeActivePreviewBoard.js\` ranks the eligible 941 players, adding existing website XP only when \`arcadeSqueegeeLink.js\` has privately verified their Squeegee customer UUID. In that case, the Squeegee UUID is irreversibly mapped into the public NBG reference by the same algorithm as the import and joined to one row. Conflicting private links with the same Squeegee customer are held rather than double counted.
- \`netlify/functions/arcadeLeaderboard.js\` serves this embedded dataset **only if** the request's Host is exactly \`deploy-preview-77--nibinguy.netlify.app\`, there is no private approved snapshot, and the owner has not enabled the hide/active-only mode latch. Production's main branch is unchanged. The public JSON exposes only rank, \`customerRef\`, \`town\`, points, aggregate total and date.
- \`/api/squeegee-preview-leaderboard-history\` explains that the dated public snapshot is preloaded. The owner-only **HIDE HISTORICAL LEADERBOARD** control stops serving the preloaded scores without deleting private XP. Future owner CSV imports remain staged privately until a separate explicit publish action.
- Historical snapshots expire after 7 days without a verified new active account-status source; after that, rankings are hidden rather than continuing to list potentially deactivated customers. This is **not** an automatic payment sync. Existing website XP is still preserved if the customer's Squeegee UUID is not yet verified.
- Since a town + pseudonymous reference + number of paid cleans may still amount to personal data, ensure a suitable lawful basis, privacy notice and participation/objection controls *before promoting this to Production*. Do not claim this is anonymous or automatically GDPR-compliant.

Verification: \`tests/squeegee-active-preview-population.test.cjs\` checks unique refs, exact 941 accounts/20,778 points, preview-host isolation, verified XP join, duplicate prevention and stale-source suppression. Builds and tests are checked in CI. Do not claim a live HTTP deploy was independently verified unless it has been checked.


### 1 November 2026 — owner-approved NEW paid-clean STREAK SCALE

The owner changed historical Squeegee cleaning points from +1 per verified paid clean to a progressive **20, 22, 24, 26, ...** scale and requested that the next clean return to **20** whenever the customer misses a clean. Previously awarded points are retained; the streak alone resets. Website arcade/booking XP remains unchanged.

Rules for the 31 October 2026 normalized backup:
- Squeegee \`joboccurrences.status===1\` is a completed visit; the clean earns its visit's bonus **only if the related invoice is verified fully paid**. A completed but payment-unverified occurrence holds points (0 now), but counts towards attendance streak continuity.
- Squeegee \`joboccurrences.status===2\` is a recorded skipped appointment; if not deleted/archived and due by the backup date, it resets the customer visit streak to 0. The **next completed visit** earns 20 again. A skip and completed job on the same due date reset first. Pending/deleted occurrences, holiday adjustments and mere calendar gaps are **NOT** silently counted as skips.
- The streak is **per customer, per service date**, not per physical bin: two verified paid job occurrences on the same date both receive the visit's point rate, but do not increment the consecutive visit counter twice. One billable occurrence can represent several physical bins; it is not multiplied by the bin quantity.
- New verified historical points are recomputed from immutable clean occurrences, not added on top of old one-point rewards. Reimporting the same backup must never double points.
- Example: completed+paid = +20, +22, +24; Squeegee skip = 0; next completed+paid = +20; following = +22. Total 108 for those five paid appointments.
- 31 Oct backup totals: **1,022 active/non-deleted accounts**, **950 active accounts with paid history**, **941 with verified town**, **20,778 historical paid clean occurrences for those 941**, resulting in **808,316 historical streak XP** for the same 941. The top streak score is **6,738**. Across all 1,022 active records, **1,854 non-deleted recorded skipped occurrences** (1,841 unique customer-day skips) were observed; **493 active customers** had at least one such recorded skipped visit.
- Recalculated private output files are \`NI_Bin_Guy_Squeegee_Streak_Mapping_PRIVATE.csv\` and \`NI_Bin_Guy_Streak_Clean_Audit_PRIVATE.csv\`, kept out of GitHub. The public-safe \`NI_Bin_Guy_Leaderboard_STREAK_20_PLUS_2_PREVIEW.csv\` contains only reference, town and total streak XP. The source status is dated 31 October and remains subject to seven-day expiry.
- \`netlify/functions/lib/squeegeeCleaningStreak.js\` defines the deterministic policy for future updates; \`squeegeeActivePreviewSnapshot.js\` contains the re-ranked **941 public pseudonyms and 808,316 total historical points**. The owner-only import now accepts v2 with new \`streak_points\`, \`current_consecutive_clean_visits\`, \`next_completed_visit_bonus\`, \`recorded_skipped_visits\`, \`max_consecutive_clean_visits\`, and matching \`scoring_version\` columns. Publishing a v1 one-point CSV is blocked.
- The older \`squeegeeHistoricalLeaderboard.js\` dry-run **counts** fully-paid cleans and overdue invoice days for audit; it is **NOT** used to award loyalty streak XP. The owner tool labels it as legacy/diagnostic to avoid misinterpretation.
- Do not merge into production without explicit owner approval. Public pseudonyms are not guaranteed anonymous; customer privacy/participation controls still need reviewing before production exposure.
