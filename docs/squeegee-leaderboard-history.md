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
