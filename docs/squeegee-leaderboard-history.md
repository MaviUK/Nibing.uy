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

The **31 October 2026 Squeegee backup** is a historical status snapshot, not live confirmation. Verified counts: 1,022 active/non-deleted customer records; 950 had verified paid cleans; 941 of those had a confirmed town and were prepared in the active-only *preview* CSV; nine active paid-clean customers need town verification; 72 active customers have no eligible paid-clean points yet. The other 8,448 historical customer records (including deleted records, even when marked active) are excluded from the active-only mapping. No history has been published or written to the public leaderboard, and late-payment deductions remain held.

Source outputs are private local artefacts: `NI_Bin_Guy_Leaderboard_ACTIVE_ONLY_2026-10-31.zip` and `NI_Bin_Guy_Leaderboard_ACTIVE_ONLY_PREVIEW.csv`. Do NOT commit customer-level CSV, Squeegee IDs or backups to GitHub. Legacy customers **do not need website IDs**. Later join their private Squeegee UUID to website XP only on verified matches, preserving both balances and preventing duplicate points. The existing website-only arcade enrolment cannot yet guarantee Squeegee status; before combining and publishing historical/Squeegee-derived ranks, the live status-gated join must be implemented and tested separately. Preserve current Preview 1 website scores, bookings and Production while developing this. Provide suitable customer privacy information/participation controls before public publishing.


## 1 November 2026 — Active-only historical leaderboard implementation (Preview 1)

The owner-provided 31 October 2026 active-only Squeegee mapping is **1,022 active/non-deleted UUIDs**. Of these, 941 have verified town and positive paid-clean points (20,778 total); nine have eligible points but a town needing review; 72 have no verified paid cleans. The owner-approved public display shape contains only \`customerRef\`, \`town\`, \`points\`. No real Squeegee customer reference, invoice status or name is exposed.

### Components

- \`netlify/functions/lib/squeegeeActiveLeaderboardImport.js\` parses and validates the **PRIVATE** \`NI_Bin_Guy_Active_Squeegee_Customer_Mapping_PRIVATE.csv\` (not the public-compatible three-column CSV). It insists on exact active and non-deleted states, validates the UUID-derived public pseudonym, refuses duplicated or malformed identifiers, reviews unknown towns and caps file size.
- Existing owner-authenticated \`/api/squeegee-preview-leaderboard-history\` (Preview 1 only) has an **Import active customers — private review** form; upload the PRIVATE mapping CSV once and enter its actual Squeegee backup date (initially 2026-10-31). The entire new eligible pool replaces the prior one. Repeating the same file/date is a no-op. Source CSV bytes are **not** retained; normalized private UUID/reference/town/paidClean tuples go to the dedicated preview-only Netlify Blob store \`n64-preview1-squeegee-active-only\`. Do not upload the customer mapping to GitHub, Netlify Forms, or the public site.
- The same owner page displays a private top ten and a **separate publish button**. The publish action requires an active owner OTP session, same-origin form POST, a checked privacy/participation control declaration, and a source snapshot within seven days. It can be un-published immediately using the same owner page.
- \`arcadeLeaderboard.js\` reads and ranks eligible history **only when the owner explicitly publishes it**. Once that is done, website-only users with an unverified Squeegee account are held from this combined active-only board, but their original XP records stay untouched. A stale active-status snapshot hides history rather than displaying potentially deactivated customers indefinitely; status reflects the backup date, **not** a fresh Squeegee API check. Existing pre-import website leaderboard continues until the active-only snapshot is published.
- \`netlify/functions/lib/arcadeSqueegeeLink.js\` can link website XP to the real immutable Squeegee UUID *only after a Squeegee job is confirmed successful* and the enrolled player's exact name, email and service property match the accepted booking. The link stores only verified UUID and email-derived private player key in a separate preview store, with an atomic create-if-new guard. Multiple website bookings with one email, conflicts, and unidentified customers are held rather than merged. This link is performed by the existing preview-only booking worker as a best-effort side effect after job claims succeed; no booking or Squeegee job is retried due to linkage failures.
- Public leaderboard scoring is **historical paid completed cleans (+1 each) plus existing website XP only after verified UUID linkage**. The historical-overdue deduction is **NOT** applied. A customer counts once even if both sources exist. The public API uses an explicit reference/town/points allowlist; it never returns UUIDs or payment details.
- Existing website still has only a Top 10 board, but all 941 approved historical candidates participate in ranking. A separate self-contained owner HTML preview for the 941 entries is available as a local ChatGPT artifact, not committed to GitHub.

### Safety and outstanding verification

Do not merge this PR into production or upload raw customer spreadsheets to GitHub. The feature is Preview 1 only, **not** yet seeded in Netlify until the owner signs in and imports the private mapping CSV. The local HTML preview is created, but is independent of website storage. The user must review privacy notices/lawful basis and arrange suitable participation controls before publicly exposing pseudonymous customer data; a town/reference pair may still be personal data. The backup's active status is historical: there is no live status refresh yet. The seven-day fail-closed policy prevents indefinite publication of stale accounts. A future read-only Squeegee customer-status sync can automatically hide deactivated entries without requiring payment-history API endpoints. Payment-history API access is still required for automatic paid-clean point updates.
