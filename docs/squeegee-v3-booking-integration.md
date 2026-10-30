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

## Booking-first shadow integration on Preview 1 (30 October 2026)

Both booking channels now prepare Squeegee read-only plans **after the existing booking has been accepted**:
- `sendBookingEmail.js` (email) calls `stageWithoutBlockingBooking(payload, {channel:'email'})` after successful admin email and normal leaderboard handling. The staging helper independently calls existing Preview 1 `/api/booking-schedule` to recalculate the date.
- `sendTosReceipt.js` (WhatsApp) reuses the existing server-calculated schedule **after** confirmation emails, booked status and normal leaderboard handling, then calls `stageWithoutBlockingBooking(payload, {channel:'whatsapp',serverSchedule:schedule})`.
- `squeegeeBookingStage.js` uses Squeegee `GET /services` only; **never POST**. When runtime supports `getContext().waitUntil`, preparation runs after response; otherwise a bounded 900ms best-effort fallback avoids slowing customer confirmation excessively.
- A private Netlify Blob `squeegee-preview1-booking-readonly` holds only `bookingId`, channel, per-bin status/date/quantity/price, validation flags and blocked reasons. It stores **no customer names, phone numbers, addresses, emails or Squeegee UUIDs**. This is **not** a transactional ledger, and loss of a shadow audit must never change booking confirmation.
- `squeegeeBookingPricing.js` independently verifies current website prices (including commercial plans), expired/ineligible discount codes, quantity limits and seven-for-six, and rejects any modified/missing/extra client pricing line.
- `squeegeeScheduleCheck.js` compares the customer-visible browser snapshot against the independently calculated server schedule **per bin** and explicitly blocks changed/unconfirmed dates, swapped bin types, mismatched BT postcodes or uncovered towns. A missing snapshot is a manual hold, never an invented date. Numeric Squeegee job groups have not been confirmed as cleaning rounds.
- `squeegeeBookingPreparation.js` combines the canonical price, approved-date comparison and dynamically resolved account services into a private future-job plan. Its public/Blob summary states `approvedToWrite:false` and always requires verified group mapping before write activation.
- `squeegeeIdempotencyClaims.js` provides future fail-closed atomic single-key `onlyIfNew` reservations and `onlyIfMatch` state changes with nonempty ETag checks. This protects same customer/bin/plan/date even if a second booking ID is generated. A post/timeout with uncertain result requires reconciliation: **no automatic retry**. It is NOT connected to Squeegee POSTs or the current booking flow yet. Conditional single-key writes are not a multi-operation transaction.
- CI tests mock all API calls and Netlify Blobs; **53/53 passing** as of 30 October 2026. Tests never create Squeegee customers or jobs.

Pending before any LIVE Squeegee write: match customer across all pages within a bounded limit; verify service and round mapping, personally approve one controlled test booking, implement a restricted writer that consumes the atomic claim protocol, reconcile any ambiguous results and manually inspect job dates/4-week recurrence in Squeegee. The existing website behaviour and leaderboard remain authoritative while in shadow mode.

**No production or Preview 2 change, no merge to main, no live Squeegee record creation/alteration.**

## Historical job-group audit (30 October 2026) — partial, read-only

Using a temporary Preview 1 GET-only endpoint, Squeegee returned **1,200 customers across the first 12 pages**, with `hasMore: true`. This is a **partial sample**, not a complete census; group-to-town associations are descriptive only and never authorised for automatic scheduling.

- 14 numeric job groups, 1,010 distinct customer-group associations in the sample (including addresses where town couldn't be identified).
- Groups `01`, `02`, `03`, `04`, `16`, `17`, `18`, `19` have customers in BOTH Bangor and Newtownards. Thus **do not map a group by town alone**.
- Group `13` had 61 recognised Donaghadee customer associations in this sample; this is **not proof** of its service weekday, collection-cycle anchor or cleaning dates.
- Group `14` had both Donaghadee and Newtownards customers.
- No personal customer information, raw UUIDs or individual addresses were output; aggregate town cells under 5 were suppressed. The temporary endpoint/workflow were removed after inspection.

A second temporary GET-only probe retrieved one individual customer record's **field names only**, never its personal values. Individual `GET /customers/:id` returned the SAME customer schema as the list: `jobs[]` contained `_id, services, jobGroup, price`, with **no appointment date/recurrence/day/round schedule fields**. The probe was also removed.

**Blocker:** Ask the account owner to open the Squeegee scheduling/rounds UI and show which numeric job group corresponds to each actual cleaning route/weekday/cycle (including bank-holiday rescheduling). Don't infer weekdays from historic town distribution. Until mapping is confirmed, keep `jobGroupFor` unresolved and all Squeegee POSTs disabled.

Duplicate-claim improvement: future customer/job reservations now hash property plus postcode rather than using email, so changing email alone cannot bypass duplicate protection for the same address. This is still code-only, not a live write mechanism.


## Owner-confirmed four-week Squeegee round cycle (30 October 2026)

Owner explicitly confirmed:

- **Monday 2 November 2026 is Round 11**, the Monday of Week 3.
- **Week 1:** Rounds 1, 2, 3, 4, 5
- **Week 2:** Rounds 6, 7, 8, 9, 10
- **Week 3:** Rounds 11, 12, 13, 14, 15
- **Week 4:** Rounds 16, 17, 18, 19, 20

Day-order interpretation for the preview algorithm: each week's five numbers correspond in sequence to Monday through Friday. The **user has verified the Monday Round 11 anchor**; the weekday ordering is the natural continuation and must be confirmed by inspection of the first controlled test, especially on moved collection days.

| Week / Monday date | Mon | Tue | Wed | Thu | Fri |
| --- | --- | --- | --- | --- | --- |
| Week 1: 19 Oct 2026 | 1 | 2 | 3 | 4 | 5 |
| Week 2: 26 Oct 2026 | 6 | 7 | 8 | 9 | 10 |
| Week 3: 2 Nov 2026 | 11 | 12 | 13 | 14 | 15 |
| Week 4: 9 Nov 2026 | 16 | 17 | 18 | 19 | 20 |
| Week 1: 16 Nov 2026 | 1 | 2 | 3 | 4 | 5 |
| Week 2: 23 Nov 2026 | 6 | 7 | 8 | 9 | 10 |
| Week 3: 30 Nov 2026 | 11 | 12 | 13 | 14 | 15 |

Implementation:

- `netlify/functions/lib/squeegeeRoundCycle.js` computes the week and round from the *server-verified* per-bin clean date using the **2 November 2026 Monday anchor**, modulo four weeks, independent of town.
- For NI Monday bank holidays, the website moves Monday-Friday cleaning to Tuesday-Saturday. The resolver mirrors the existing website rule (including the site's **no Christmas/Boxing Day substitute Monday shift**). Any **four-weekly recurring clean with a first appointment in a shifted week** is held for review because anchoring Squeegee recurrence to Tuesday/Saturday would move normal future weeks to the wrong day. Dates for one-off cleans can be calculated but remain subject to other gates.
- Resolved numeric group codes are matched uniquely against actual Squeegee `GET /job-groups` results. The planner passes the real UUID only for a unique valid account group and verified date. **Never construct/fabricate a group UUID**.
- The most recent account list had only 14 of the 20 numbered job groups: **01, 02, 03, 04, 08, 09, 11, 12, 13, 14, 16, 17, 18, 19**. Missing from that GET response: **05, 06, 07, 10, 15, 20**. If one is required but not in the API response at booking time, the affected job stays `job_group_mapping_required`. The API did not expose a documented create-group endpoint; **do not auto-create missing groups**.
- `squeegeeBookingStage.js` now performs `GET /job-groups` alongside `GET /services`, in **read-only shadow mode** for both email and WhatsApp booking submissions.
- `squeegeeBookingPreparation.js` now includes group-number, rota-week, bank-holiday-shift and resolution status in private PII-free booking staging. `squeegeeBookingPlan.js` prevents a real job body from being marked ready if its required verified group is unavailable.
- GitHub Actions tests for round cycling, shifts, missing/duplicate account groups, bad IDs and prepared booking date+group mapping: **78/78 passing** as of this update.

**Still no Squeegee POST**, no real customer/job creation, no production changes and no merge. Before first write, verify round weekday ordering in Squeegee and explicitly obtain owner's test-record approval. Continue keeping the existing website's bookings, confirmation emails, WhatsApp and arcade score working.


### Verified against authenticated account groups (GET only)

A one-off Preview 1 probe `GET /api/v3/public/job-groups` verified the owner-supplied November cycle, and returned **14 account job groups**. The resolver now maps the following proposed dates to valid account-group UUIDs (UUIDs never left Netlify): 2 Nov → 11, 3 Nov → 12, 4 Nov → 13, 5 Nov → 14, 9 Nov → 16, 16 Nov → 01, 30 Nov → 11.

The same read-only probe confirmed the corresponding numbered groups are **not returned** for these proposed dates: Fri 6 Nov → 15, Fri 13 Nov → 20, Fri 20 Nov → 05, Mon 23 Nov → 06, Fri 27 Nov → 10. Across all 20 potential rounds, `05, 06, 07, 10, 15, 20` are currently absent from the API. Do not fabricate them or assign a different round. **The API's group-label match proves availability only, not that the guessed Monday-Friday day order matches the actual Squeegee timetable.**

The temporary public diagnostic endpoint and one-shot GitHub Actions workflow have both been removed. Squeegee customer/job writes remain blocked; the normal website booking form, confirmation emails and arcade score were not changed by the mapping.
