# NI Bin Guy / Squeegee API v3 — booking integration (PREVIEW 1 ONLY)

Last reviewed: 30 October 2026  
Source: https://api02.sqgee.com/api/v3/docs (retrieved unauthenticated using a temporary, read-only GitHub Action).  
Scope: GitHub branch `preview/n64-retro-site`, PR #77. **Never merge or deploy to production without owner approval. Never change Preview 2.**

## Business requirement

A customer enters full BT postcode and chooses one or more bins. The existing website's scheduled `assignedCleanDate` for **each individual bin** must be the Squeegee first appointment date. One-off bookings create an adhoc job. Four-weekly plans must recur every four weeks from their assigned date. Mixed-bin dates stay separate. Unknown dates remain pending, never guessed. Customer matching must be duplicate-safe and preserve existing email, WhatsApp, confirmed-booking reference, XP and global leaderboard.

## Verified Squeegee API contract

Base: `https://api02.sqgee.com`  
Auth: `Authorization: Bearer <API_KEY>`  
Successful response: `{success: true}` or `{success: true, data: ...}`  
Error response: `{success: false, error: string, code: integer}`

- `POST /api/v3/public/customers` — create customer; body requires `name` (3–52 chars) and `address: {text: string(5–100), coords?: {lat,lng}}`. Optional `email`, `phone`, `notes` (max 500), `reference` (max 50). Can accept `jobDetails[]` up to 3 and `quoteDetails[]` up to 10. Success returns customer ID string in `data`. Do **not** assume an atomic multi-job create without verifying.
- `GET /api/v3/public/customers` — list customers, optional `page` (>=1) and `pagedRequestId` (UUID). Actual `CustomerPage` data shape must be tested with a real read-only key before matching existing customers.
- `GET /api/v3/public/customers/external-id?externalId=...` — resolve customer by external reference (length 1–50); success returns customer ID string.
- `GET /api/v3/public/customers/:customerId` — retrieve single customer, optional `includeBalance`.
- `GET /api/v3/public/services` — returns `[{id,description}]`; use these account-specific UUIDs, never fabricated IDs.
- `GET /api/v3/public/job-groups` — returns `[{id,description}]`; optional `description`. `jobGroup` is an optional UUID in job creation. Confirm its relationship with actual cleaning rounds before using it as a round assignment.
- `POST /api/v3/public/customers/:customerId/jobs` — create job. Body `AddJobBody`:
  - `date?: YYYY-MM-DD`
  - `frequencyType: 'adhoc' | 'days' | 'weeks' | 'dayOfMonth' | 'monthlyDayOfWeek'`
  - `frequencyInterval?: number`
  - `services: UUID[]`
  - `jobGroup?: UUID`
  - `notes: string`, `tags: string[]`
  - `firstAppointment: {tags: string[], initialDate?: YYYY-MM-DD}`
  - `jobAddress?: Address`
  - `price?: number`
  - Returns `{success: true}` (no job ID documented). There is **no documented idempotency-key parameter or job lookup endpoint** in the provided reference. A timeout must not trigger an automatic duplicate job retry.

The documentation currently does not specify numeric rate limits or write idempotency guarantees. Use timeout limits and do not retry writes blindly.

## Preview implementation status

- `src/bookingScheduleBridge.js` exposes an in-memory `window.nbgGetBookingScheduleSnapshot()` of what is displayed in the booking form.
- `src/LandingPage.jsx` sends that snapshot in both WhatsApp/email payloads. It is **untrusted browser data** until recomputed and compared on the server.
- `netlify/functions/sendBookingEmail.js` records it in existing private booking audit; this is not a Squeegee job.
- `netlify/functions/bookingSchedule.js` is the existing server-side date calculator. The WhatsApp pipeline already reruns it.
- `netlify/functions/lib/squeegeeApiV3.js` implements documented GETs and POSTs. POSTs fail closed unless every owner-approval, atomic-ledger, and Preview 1 gate is enabled. No Squeegee key is configured yet.
- `netlify/functions/lib/squeegeeBookingPlan.js` constructs customer fields, external customer reference and per-bin job bodies using a **verified server-side schedule**. It refuses unverified prices and unknown service mapping. Job plan is not permission to write.
- `tests/squeegee-integration.test.cjs` tests dates, recurrence, postcode mismatch, one-offs, mapping, and disabled writes. CI in `.github/workflows/squeegee-preview-tests.yml` runs no live API calls.

## Remaining before enabling any customer/job writes

1. In Squeegee, owner creates one API key with least required permissions: Find a customer, List customers, View a customer, Services, Job groups, Create customers, Add jobs. Do not paste key into ChatGPT or GitHub.
2. Store `SQUEEGEE_API_KEY` as a **secret** in Netlify's **Branch** context for `preview/n64-retro-site` (Functions scope). Do not put it in `all`, `production`, or the entire `deploy-preview` context — that could expose it to Preview 2. Netlify supports branch contextual values in Deploy Previews; confirm available account plan/UI before proceeding.
3. Using GET only, inspect actual customer pagination/fields, customer lookup results, available service IDs, and job group IDs. Map bins/areas to real IDs and decide handling of manually-created customers.
4. Add *server-side* schedule revalidation for both channels. Compare with website's submitted snapshot, **stop automatic Squeegee scheduling if date differs**, and preserve the existing customer email/confirmation/XP pipeline.
5. Add server-side pricing validation including discounts and 7-for-6. Never trust browser-submitted `lineTotal` for API writes. Define the job price for multiple bins in one line.
6. Add a durable **atomic** per-booking and per-job idempotency ledger and reconciliation UI. The existing Netlify Blob `get` then `set` replay guard is not atomic enough for Squeegee writes. A partial failure or ambiguous timeout must be reviewed, not blindly retried.
7. Ask owner to approve one controlled test customer/job. Verify first appointment, 4-week recurrence, service mapping and any jobGroup mapping directly in Squeegee.
8. Only then enable automatic preview writes, complete real-device tests, and separately request approval for production migration/launch.

At present the existing website continues using its original booking email/WhatsApp flow and live Squeegee records remain untouched.

## Read-only connection test and actual account shapes (30 October 2026)

Key `SQUEEGEE_API_KEY` verified via Netlify: secret=true, scope=Functions, branch override exactly `preview/n64-retro-site`, and no values assigned in Production, generic Deploy Previews, generic Branch Deploys or Preview 2. Never expose the value.

Verified calls from Preview 1 Netlify Functions (GET-only; 200/success):
- Services: **13** account services. Exact booking-relevant descriptions:
  - Four-weekly: `Black`, `Blue`, `Brown`, `Green`.
  - One-off: `(One Off) Black`, `(One Off) Blue`, `(One Off) Brown`, `(One Off) Green`.
  - Other entries are early-cancellation, glass-caddy/glass-bin and surcharge services; do not use for normal website bookings.
  - No separately named commercial-bin service was identifiable. Block commercial assignment until explicitly verified.
- Job groups: **14**, descriptions are numeric codes `01` through `19` with gaps. Their correspondence to actual towns, rounds or drivers is **not established**. Never guess `jobGroup` from the numeric label; it is optional in `AddJobBody`.
- Customer listing: authenticated GET succeeded. `CustomerPage` shape `{customers, page, pageSize, hasMore, pagedRequestId}`. Customer entries include `_id`, `name`, `address`, `phoneNumber`, `phoneNumberOther`, `email`, `_externalId`, `status`, `jobs`.
- Customer address returned is `{addressDescription, lngLat}`, **not** creation's `Address {text, coords}`. The lookup matcher supports `addressDescription`.
- Customer `jobs[]` item includes `_id, services, jobGroup, price`, **but does not include first appointment date or job notes** in the inspected response. No idempotent retry can rely on a booking-ID search across jobs through the documented customer-list API.

The temporary Preview 1 diagnostics Function and GitHub Actions workflow used to perform these reads were **deleted after successful verification**. No customer data/credentials were returned by the diagnostics; only counts, account service/job-group labels and response field names were inspected.

**Implementation prepared:**
- `netlify/functions/lib/squeegeeServiceCatalog.js` maps domestic bin colour and one-off/4-weekly plan to exact Squeegee descriptions; UUIDs are dynamically resolved server-side from `GET /services`. Commercial services intentionally unresolved.
- `netlify/functions/lib/squeegeeCustomerMatcher.js` matches existing customers by exact external reference or full property+postcode+contact; scans **all** `CustomerPage` pages with `pagedRequestId`; ambiguous matches and truncated pagination are held for review, never treated as new.
- Test suite: **21/21 passing**, including service distinctions, exact dates, unknown commercial plans and duplicate avoidance. These are no-network unit tests, not a successful real job write.

**No automated Squeegee writes are active.** Before enabling writes: server-side recalculation/verification of price and dates, durable atomic per-job ledger, round mapping approval, and explicit owner approval for a controlled test record. Keep the email/WhatsApp booking, terms receipt and XP/leaderboard unaffected throughout.
