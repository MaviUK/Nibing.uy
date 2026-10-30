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

**Resolution (subsequent owner confirmation):** Each numbered round runs on its **own distinct day**. Combined with Monday 2 November 2026 = Round 11 and five rounds per week, the mapping follows consecutive Monday–Friday operational days. Job groups must still be found in this account, and the date shown on the booking form must be server-verified. No Squeegee POSTs have been enabled.

Duplicate-claim improvement: future customer/job reservations now hash property plus postcode rather than using email, so changing email alone cannot bypass duplicate protection for the same address. This is still code-only, not a live write mechanism.


## Owner-confirmed four-week Squeegee round cycle (30 October 2026)

Owner explicitly confirmed:

- **Monday 2 November 2026 is Round 11**, the Monday of Week 3.
- **Week 1:** Rounds 1, 2, 3, 4, 5
- **Week 2:** Rounds 6, 7, 8, 9, 10
- **Week 3:** Rounds 11, 12, 13, 14, 15
- **Week 4:** Rounds 16, 17, 18, 19, 20

**Latest owner confirmation:** Every numbered round has a distinct day, with no simultaneous rounds. Together with the Round 11 Monday 2 November anchor and five groups per week, **rounds advance Monday–Friday**, then repeat every four weeks. Unused Squeegee group numbers reflect areas whose **bins are emptied on Fridays**, not necessarily cleaning jobs performed on Friday. Hence groups 06/07 can be inactive Monday/Tuesday cleaning groups for Friday-bin-emptying areas. This does not invalidate the daily round sequence.

| Week commencing | Cycle week | Mon | Tue | Wed | Thu | Fri |
| --- | --- | --- | --- | --- | --- | --- |
| 19 Oct 2026 | Week 1 | 1 | 2 | 3 | 4 | 5 |
| 26 Oct 2026 | Week 2 | 6 | 7 | 8 | 9 | 10 |
| 2 Nov 2026 | Week 3 | 11 | 12 | 13 | 14 | 15 |
| 9 Nov 2026 | Week 4 | 16 | 17 | 18 | 19 | 20 |
| 16 Nov 2026 | Week 1 | 1 | 2 | 3 | 4 | 5 |
| 23 Nov 2026 | Week 2 | 6 | 7 | 8 | 9 | 10 |
| 30 Nov 2026 | Week 3 | 11 | 12 | 13 | 14 | 15 |

Each table entry is a **cleaning round/day**, not a bin-emptying weekday. Missing Squeegee groups remain inactive and cannot receive automatic bookings.

Implementation:

- `netlify/functions/lib/squeegeeRoundCycle.js` computes the owner's confirmed **cycle week and one-distinct-round-per-day sequence** from the *server-verified* per-bin clean date using the **2 November 2026 Monday anchor**, modulo four weeks. It resolves an account group UUID only if that numbered group actually exists; absent groups stay blocked.
- For NI Monday bank holidays, the website moves Monday-Friday cleaning to Tuesday-Saturday. The resolver mirrors the existing website rule (including the site's **no Christmas/Boxing Day substitute Monday shift**). Any **four-weekly recurring clean with a first appointment in a shifted week** is held for review because anchoring Squeegee recurrence to Tuesday/Saturday would move normal future weeks to the wrong day. Dates for one-off cleans can be calculated but remain subject to other gates.
- Resolved numeric group codes are matched uniquely against actual Squeegee `GET /job-groups` results. The planner passes the real UUID only for a unique valid account group and verified date. **Never construct/fabricate a group UUID**.
- Account groups returned: **01, 02, 03, 04, 08, 09, 11, 12, 13, 14, 16, 17, 18, 19**. Unconfigured groups: **05, 06, 07, 10, 15, 20**. Their absence is intentional because the owner does not cover certain **Friday bin-emptying areas**. Round 06/07 are operational Monday/Tuesday slots in Week 2; they can be unused if those are the cleaning dates for Friday-emptying areas. **Do not add or substitute missing Squeegee groups.**
- `squeegeeBookingStage.js` now performs `GET /job-groups` alongside `GET /services`, in **read-only shadow mode** for both email and WhatsApp booking submissions.
- `squeegeeBookingPreparation.js` now includes group-number, rota-week, bank-holiday-shift and resolution status in private PII-free booking staging. `squeegeeBookingPlan.js` prevents a real job body from being marked ready if its required verified group is unavailable.
- GitHub Actions tests for round cycling, shifts, missing/duplicate account groups, bad IDs and prepared booking date+group mapping: **78/78 passing** as of this update.

**Still no Squeegee POST**, no real customer/job creation, no production changes and no merge. Before first write, explicitly obtain the owner's test-record approval and check the actual first appointment, four-weekly recurrence and cleaning group. Keep the existing website's bookings, emails, WhatsApp and arcade score working.


### Verified against authenticated account groups (GET only)

A one-off Preview 1 probe `GET /api/v3/public/job-groups` confirmed **14 numbered account groups exist**. The owner subsequently confirmed **each round has a distinct cleaning day**, so the weekday sequence is now available for mapping alongside the Monday 2 November anchor. The API lookup determines whether the numeric group exists, not whether its bin-emptying area is covered; the booking website's existing date validation remains authoritative.

The account does not return group labels `05, 06, 07, 10, 15, 20`. Their absence is an **intentional coverage choice**, not missing configuration. Do not fabricate or replace them. Friday **bin-emptying** exclusions differ from cleaning jobs that happen on Fridays; the booking form's council-based date checks remain authoritative.

The temporary public diagnostic endpoint and one-shot GitHub Actions workflow have both been removed. Squeegee customer/job writes remain blocked; the normal website booking form, confirmation emails and arcade score were not changed by the mapping.

### Coverage clarification and automatic-write safety (30 October 2026)

The owner confirmed that Friday bin-collection areas are not currently covered and the missing Squeegee groups are intentional. **Do not create 05, 06, 07, 10, 15 or 20 solely to complete 1–20.** The missing codes cannot be interpreted as weekday labels without additional route/weekday evidence.

Preview 1 has been updated: `roundForCleaningDate` retains confirmed four-week cycle membership and a **tentative** weekday candidate for internal diagnostics; `resolveSqueegeeRoundJobGroup` refuses to return a Squeegee UUID unless date-to-round assignment has been explicitly confirmed. As of this update only **Week 3 Monday → 11** is confirmed. New status `weekday_mapping_unverified` safely holds other weekdays, including dates whose proposed group labels happen to exist. No website booking or council schedule logic has been changed, no Squeegee POST has been enabled.

### Latest owner clarification: each numbered round is a different cleaning day

The owner confirmed no two numbered rounds currently run on the same day. Interpret the five round numbers in each week as **Monday to Friday** in order. The website remains the authoritative source of each bin's first cleaning date. Only map that date to Squeegee when the exact numbered group exists in `GET /job-groups`. A missing group is an intentional not-covered/unused area and is not automatically created.

The separate restriction on **areas with Friday bin collections** must not be confused with the **day NI Bin Guy performs the clean**. This resolves the earlier apparently conflicting observations for groups 06/07. Holiday shifts keep their existing special logic; when a recurring first appointment falls in a shifted week, it remains held to avoid repeating the wrong weekday.

The Preview 1 tests now cover the full distinct-daily-round sequence and deliberately missing groups. **All real Squeegee customer/job POSTs remain disabled** pending explicit approval for one controlled test booking. Production, Preview 2 and main remain unchanged.


## Controlled test booking completed (30 October 2026)

Owner explicitly approved **one controlled test** to validate the new authenticated Squeegee v3 create-customer and add-job endpoints. It was performed exclusively from Preview 1 through a GitHub Actions signed OIDC identity, with fixed synthetic values and the following safeguards:

- Test reference: `NBG-P77-CONTROLLED-TEST-20261030-R11`
- Name: `NI BIN GUY - API TEST - DO NOT CLEAN`
- Address: a visibly fictitious **TEST RECORD / DO NOT VISIT**, Bangor BT20 4AA (no real customer, no email, no phone, no coordinates)
- Service: existing account `Black`; group: existing account `11` (actual IDs obtained by GET; none hard-coded)
- First appointment submitted: **2026-11-02**, Monday
- Recurrence submitted: `frequencyType:"weeks", frequencyInterval:4`
- First appointment submitted with matching `firstAppointment.initialDate:"2026-11-02"`
- Price: **£0**; notes explicitly `DO NOT VISIT, CLEAN, INVOICE OR BILL`
- 1,845 customer records scanned across all 19 API pages to rule out an existing test reference/name
- **GitHub Actions run 41069425934**: Squeegee returned HTTP **200**, `customerCreated:true`, `jobCreated:true`, status `test_customer_and_job_created`. No additional customer/job creation requests or automatic retries were made.

**Idempotency fix found during testing:** The original test's atomic lock failed *before any Squeegee POST*, and a read-only audit confirmed no Squeegee test customer and no stored lock. Netlify Blobs' conditional writes worked when using an injected, runtime-managed `getStore({name,consistency:'strong'})` instance. Both conditional `onlyIfNew` reservation and ETag `onlyIfMatch` state transition were verified on harmless diagnostic markers. The successful test passed that validated store instance explicitly into `claimOnce` and `changeClaimState`, and returned success only after those claim transitions. The generic `getClaimsStore()` helper was changed to use Netlify's runtime-managed credentials rather than manually override them.

**Important remaining verification:** Squeegee's public customer/job GET response does **not** expose first appointment and recurrence settings. Therefore successful POST means Squeegee *accepted the job body*, **not that the actual scheduling UI has been visually checked**. The owner should find the synthetic test customer by exact reference/name in Squeegee, inspect Round 11 / 2 Nov / every 4 weeks, then delete or deactivate that clearly labelled test customer/job so it does not appear in operational planning. The current API docs did not provide a delete endpoint, so no remote deletion was attempted.

**Security cleanup:** The temporary public callable controlled-test Netlify Function and GitHub Action, along with the test-only writer, OIDC verifier, data and tests, were removed from the preview branch immediately after the successful test. The standard booking-email/WhatsApp Squeegee integration is STILL READ-ONLY; general `squeegeeApiV3` POST safeguards remain closed. No production/Preview 2 changes or merge to main were performed.

**Next production feature:** With the documented job/date structure verified by POST and after the owner confirms the in-app recurrence, complete the normal booking-event writer with the same injected atomic-claims protocol, match existing customers safely and turn on automatic Squeegee writes in a separately approved stage.


## Owner-supervised one-booking test on Preview 1 (30 October 2026)

The owner approved testing **one real test customer and one job**, but has not yet submitted a test form. The final implementation is **operator opt-in**, not general automatic Squeegee import.

### Operator-facing mobile sequence (only after all tests pass)

1. Open `https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-test` on the Android browser.
2. Tap **Email my one-time test code**. A ten-digit, 15-minute code is sent through **Resend**, which the business already uses, to `BOOKINGS_TO` (defaults to `info@nibing.uy`). The email recipient cannot be changed by visitors. The code is never shown on the public page.
3. Enter the emailed code to get a 20-minute **Secure, HttpOnly, SameSite=Strict** signed owner-session cookie and an untrusted UI hint cookie (`nbgSqTestArmed=1`).
4. On **Preview 1 only**, fill out the **existing NI Bin Guy booking form** for a **new** test customer whose property is not in Squeegee, with **exactly one domestic bin**, **4-weekly (£5)**, an accurately council-verified scheduled date in the next 45 days, and no discount code. Use **Email booking** (not WhatsApp) and agree to terms. The current booking email, confirmation and XP rules remain intact.
5. After the booking email endpoint succeeds, the frontend sends that already-accepted booking's payload plus its **server-signed `arcadeBookingProof`** to `POST /api/squeegee-preview-test-submit` **only** when the UI hint is present. The modern handler requires the signed HttpOnly cookie, exact Preview 1 Netlify `Context` / site ID / hostname, valid signed proof for the **same customer, address, bin, booking reference**, and `context.waitUntil`. No test request is sent for ordinary visitors.
6. The worker independently recomputes the date from the booking-schedule API, verifies all server prices, checks Squeegee service and numbered job-group IDs through GET-only calls, scans **all** Squeegee customer pages, and **refuses to modify an existing customer**. If any validation fails, it marks the test **held** and sends **zero POSTs**.
7. Before **any** Squeegee POST, the worker reserves an immutable global **one-test** key plus a property customer claim and a property/bin/plan/date job claim using Netlify Blobs `onlyIfNew` / strong consistency. The global claim allows just **one customer and one job**. Claims are never silently released and Squeegee POSTs are never automatically retried.
8. If the claims and ETag compare-and-set transitions all succeed, the worker calls **at most one** `POST /customers` and **one** `POST /customers/:id/jobs`, in an AsyncLocalStorage-scoped write capability. The customer is labelled **TEST API** in Squeegee, and the job uses **date=firstAppointment.initialDate**, correct dynamic service + job-group UUID, **frequencyType=weeks / frequencyInterval=4**, and the server-confirmed £5 price.
9. The owner checks result through the same test page by entering the resulting `NBG-...` booking reference. Only non-PII status, clean date and round are displayed. The owner then inspects the record in Squeegee, **disables dispatch/billing and removes the test customer/job** manually after verifying recurrence. A failed or ambiguous response remains marked **requires_reconciliation**, and must **never be retried without a manual check**.

### Security and deployment notes

- The server must use Netlify **modern Function `context.deploy.context`, `context.site.id`, exact request hostname and `context.waitUntil`**. A read-only live Preview 1 diagnostic revealed `process.env.CONTEXT`, `BRANCH`, `REVIEW_ID`, `DEPLOY_PRIME_URL` are **not exposed at function runtime**, and `@netlify/functions.getContext()` is unavailable in the legacy booking handler. The implementation was corrected: legacy `sendBookingEmail.js` remains untouched for direct writes, and the operator-only test POST goes to a separate modern Function.
- `SQUEEGEE_API_KEY` is still a Netlify **secret with Functions scope and branch override ONLY `preview/n64-retro-site`**. Neither Preview 2 nor production has a configured value. The HMAC test cookie is derived server-side with purpose separation; API key/code never appears in the frontend, HTML, public status or GitHub logs.
- No generic `SQUEEGEE_WRITE_ENABLED` / production automatic import toggle has been enabled. The existing Squeegee API POST methods still reject normal calls. Only the atomic-proof, strict trusted-scope, async-context one-shot test path can invoke them.
- The current preview reads no live customers until the **owner activates an email-code session AND submits a signed, accepted test booking**. No real Squeegee POST has yet been made.
- GitHub Action `squeegee-preview-tests.yml` uses **mock** Squeegee requests/Blobs, never real customer/job API writes. `squeegee-preview-build-smoke.yml` builds the full site with the existing booking-security scripts. `squeegee-preview-test-readiness.yml` was a temporary read-only diagnostic of the deployed owner-page/scope/worker capability; remove its diagnostic endpoint after verification.
- Existing security build script `scripts/hardenBookingSubmissions.cjs` was updated to recognise the replay-protected **named emailBookingPayload** introduced solely to hand the *same accepted* booking to the test endpoint. The original `bookingId` / `submittedAt` checks remain enforced.
- The supervised test is an exception, not a full production integration. Enable general automated booking-to-Squeegee only after the owner inspects test date, price, four-week recurrence and job-group assignment, and separately approves production changes.


## Preview 1 automatic booking sync foundation (30 October 2026)

The owner verified in the actual Squeegee app that the first TEST API website booking created **one Brown-bin job**, Round 01, first clean 16 November 2026, £5, and Every 4 weeks on Monday. Squeegee generates the next appointment only after the current clean is completed. The test customer must be removed manually after verification; do not dispatch or bill it.

The owner approved further development on PR #77, branch preview/n64-retro-site only. General writes remain separate from the one-time test and must be explicitly reviewed before activation.

### Server-only automatic sync

1. The existing sendBookingEmail.js and sendTosReceipt.js keep their current owner/customer emails, WhatsApp opening, confirmation and global leaderboard behaviour. Only after confirmation succeeds do they optionally invoke the preview dispatch helper. A Squeegee failure cannot undo the accepted booking.
2. The server-only squeegeePreviewAutoDispatch helper HMAC-signs a purpose-bound event containing the accepted booking, timestamp and channel. Browser code receives no signing key or general-purpose Squeegee write API. Requests go only to the fixed Preview 1 origin and have a bounded acknowledgement wait, with **no automatic retry**.
3. The modern squeegeePreviewAutoSync Function verifies the exact trusted Netlify deploy context (Preview 1, correct hostname and site ID), signed accepted event and age before atomically saving a booking receipt. A second submission is rejected without starting another worker.
4. The automatic worker independently rechecks every website bin/date, Squeegee service/group UUID, server-calculated price including 7-for-6, booking timestamp and full Squeegee customer list. Changed/unverified dates, bank-holiday recurrence conflicts, missing groups, incomplete pagination or invalid pricing are held without a POST.
5. Existing customers are matched strictly by property/contact or stable external reference; their details are never overwritten. Jobs are added only for **different, non-overlapping services**. Unknown existing job services and existing selected-bin jobs require manual review. New customers require a permanent atomic per-property reservation.
6. Each planned job has its own permanent property/bin/plan/date claim. A whole booking is protected by a per-booking receipt and claim. Conditional Blob claims and ETag compare-and-set transitions happen before any external POST; these are per-key safeguards, **not a multi-row transaction**. Failed or ambiguous calls never retry automatically and are marked requires_reconciliation for manual inspection.
7. Each job carries its verified first clean date, mapped round, one or more Squeegee service UUIDs and the exact verified total price. Four-weekly is frequencyType weeks, frequencyInterval 4; one-off is frequencyType adhoc. Multiple different colours sharing one exact date, frequency and round become ONE combined multi-service job; bins on different dates or recurrences remain separate. Quantities above one on a single line remain in notes and line totals.
8. The owner can re-authorise with the emailed ten-digit code and view non-PII read-only progress at /api/squeegee-preview-auto-status. No force-create, duplicate retry, delete or reset control is exposed.

### Rollout switches — independently OFF by default

- SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED: leave **unset/false** until the new worker is reviewed with the owner. Branch-specific Functions-scoped Netlify env var for preview/n64-retro-site only; never configure generic Deploy Previews, Production, main or Preview 2.
- SQUEEGEE_PREVIEW_AUTO_WHATSAPP_ENABLED: separately **unset/false**. WhatsApp opens before background email confirmation and does not yet use Preview 1 email's anti-bot work challenge. Keep Squeegee WhatsApp writes disabled until the origin/anti-abuse check is audited. The existing WhatsApp booking and read-only shadow preparation remain unaffected.
- These flags are **not enabled by these code changes**; the original one-time TEST API claim remains consumed.

CI runs fake-only tests (zero real Squeegee writes) for new customers, existing customers adding different bin colours, overlapping services, date/round/price validation, two bins on distinct dates, one-off and 7-for-6 pricing, duplicate and partial job failure protection, status authentication and signed dispatch. Production, Preview 2 and the PR merge state remain untouched.

Before an automatic Preview 1 rollout: inspect the deployed endpoint, safely remove the earlier test from operational planning, agree a controlled fresh email-booking test, verify the actual Squeegee result, then deliberately enable the isolated Preview 1 flag. Never activate automatic production writes from this branch.


## 30 October 2026 — Fresh-start automatic Squeegee test (current procedure)

**This section supersedes the owner OTP and Pilot 2 recovery instructions above.** The owner abandoned the previous two-bin test because its initial one-bin admission rule rejected the submitted booking and the owner-code recovery crossed browser contexts. Do NOT create Squeegee jobs for old accepted booking `NBG-MVV99LDX-7BEDD59D85`. Its email, leaderboard points and accepted audit remain intact and must not be replayed or deleted. The old `/api/squeegee-preview-auto-recover` route now returns HTTP 410 for GET and POST without any storage or Squeegee writes.

The owner has approved exactly ONE entirely fresh test through the normal website **Submit Booking** button on Preview 1 PR #77. No OTP, recovery link or second form submission.

### Exact fresh test

- Name: **`TEST API - Fresh Sync`**, exactly.
- Select exactly **one Brown Bin**, four-weekly domestic plan, quantity 1, **£5 per clean**.
- Use a NEW property address not already in Squeegee, with a valid website-assigned date and round; use a real test inbox and required contact details.
- Press **Submit Booking** once only. This uses normal email, terms, booking reference and leaderboard logic; the accepted email handler alone signs the Preview 1 Squeegee event. No browser Squeegee POST is available.
- The confirmation now displays a test-only handoff: **Accepted for Squeegee validation** means the internal worker accepted a durable receipt (HTTP 202), not that a customer/job exists. **Not queued** or uncertain means never submit another booking; inspect the original reference.
- Logs include a PII-free `Preview 1 Fresh Sync dispatch` with bookingId, queued and reason, so the owner can provide the normal booking reference without sharing an OTP. Afterwards independently verify in the real Squeegee app ONE TEST API customer, ONE Brown job, the exact first date and round, £5 and every-four-weeks setting. The next appointment appears after completion.
- Never dispatch, clean or bill TEST API jobs. Remove the completed test manually after verification; the earlier Jimmy Smith TEST API record, if still present, requires separate cleanup. This code never deletes any Squeegee customer.

### Isolation and one-use safety

- The only allowed test is this exact name and one domestic four-weekly Brown bin; the old two-bin booking reference is explicitly blocked. All unrelated website bookings still send normal confirmation emails but do not automatically write to Squeegee during the pilot.
- This NEW test uses an immutable global CAS key `claim-v1/auto-pilot/preview77-fresh-brown-v1`; the earlier `claim-v1/auto-pilot/preview77-first-email` remains untouched. After one claim, future attempts are held even if the result is ambiguous.
- Each booking is revalidated against the server schedule, actual Squeegee service/group identifiers, price and complete customer search. Separate permanent per-booking/property/job CAS claims prevent duplicates. There is no automatic retry after an uncertain Squeegee POST.
- The signed dispatcher, function and worker require the exact Preview 1 hostname, trusted Netlify deploy-preview context and site UUID. Production, Preview 2 and main cannot use the write capability.
- The API key remains Netlify Functions-scoped in the preview/n64-retro-site branch. No global Netlify flag or secret changed. The explicit SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED=false kill switch is respected; WhatsApp-to-Squeegee remains disabled.
- Fake-only Squeegee regression tests run in GitHub Actions and as the Netlify build gate. Do NOT merge PR #77 or enable unrestricted production imports without separate owner approval.

## 30 October 2026 — General automatic Email bookings enabled for Preview 1 only

Following independent confirmation that the normal Submit Booking button created the Fresh Sync Brown customer and correctly scheduled £5 four-weekly Round 17 job for 10 November, the owner explicitly authorised expanding automatic syncing to all normal Preview 1 bookings, including multiple bin colours and repeat customers. PR #77 remains draft; there is NO production or Preview 2 integration change.

**Rollout:** `squeegeePreviewAutoRollout.js` now selects full Email sync by default only in the preview/n64-retro-site source. The dispatch endpoint and Squeegee write capability still independently enforce trusted Netlify deploy-preview context, exactly `deploy-preview-77--nibinguy.netlify.app`, and site ID. Production/Preview 2 fail closed. `SQUEEGEE_PREVIEW_AUTO_SYNC_ENABLED=false` is a kill switch; `pilot` forces test-only mode, `true` selects full mode. WhatsApp-to-Squeegee remains disabled unless independently approved. The previously abandoned booking NBG-MVV99LDX-7BEDD59D85 cannot be replayed even in full mode.

### Property and customer matching policy

- Same postcode + exact normalised service address + email or phone match: use the existing Squeegee customer, never overwrite their name, contact details, address, payment method or jobs. Independently `GET /customers/:id`, verify the authoritative saved address and inspect all existing jobs before any POST.
- Existing property, new bin colour: add only the new service(s) at the verified property without editing old jobs. Multiple different colours requested together on the SAME verified date, round and recurrence become a single job listing all their service UUIDs; different dates or frequencies remain separate jobs. Never combine using weekday labels alone, and never assign one bin the wrong date to force a merge.
- Existing property and an already-listed bin: do not silently add the same service again. The comparison covers one-off and regular service UUIDs for that bin colour. Hold for manual review if any current job already uses it, if jobs cannot be read, if customer match/address is ambiguous or if the contact differs. Website email confirmation remains valid, but the Squeegee job has NOT been created in held cases.
- Same contact/email booking another property: use a NEW address-specific Squeegee customer record with the same contact details and a note explaining the additional service property. This preserves the first property's address, jobs and billing settings. Current verified public API inputs do not safely establish multiple service addresses on one customer, so never attach a new property's job to the first customer's primary address. These records are separate for billing; the owner can manually reconcile if required.
- Multiple flats/nearby addresses that could plausibly be the same property (e.g. identical building number under same postcode but different textual address): hold until manually checked. Distinct house numbers under one postcode are allowed as different properties.

### Idempotency and customer safety

- Every accepted booking is signed server-to-server and is queued with a permanent strong-consistency receipt before the worker starts. Independent live GET checks verify Squeegee service UUIDs, 20-round mapping, prices, dates, and all customer pages.
- Permanent per-booking, per-property, per-dated-job and NEW **per-property/per-bin-colour** CAS claims prevent duplicate customer creation and concurrent repeat bookings with different first dates. Reserved or ambiguous claims are NEVER automatically cleared or retried.
- The worker blocks repeated colour lines in a single booking, because the API record cannot reliably distinguish two separate wheelie bins of the same colour at one property. A single line with quantity above one is allowed and charged at the verified total price, with quantity in job notes.
- Any uncertain customer/job POST or partially created multi-bin booking is marked `requires_reconciliation`; no automatic retry. Owner can query the reference from `/api/squeegee-preview-auto-status` with the existing owner code. Test-only Fresh Sync diagnostic and customer emails remain unchanged.
- Services absent from the Squeegee account catalog (especially commercial-specific labels) are **not auto-created**. Those bookings are held for manual mapping rather than assigned an incorrect service. The original website booking and email still work.

All testing uses fake Squeegee methods and Blob stores. General Preview 1 automatic writes start only when a NEW customer submits the actual website booking. Do not merge PR #77 or alter live operations without separate owner approval and further existing-customer/new-property verification in the Squeegee app.

### 30 October 2026 — Group compatible bin colours into one Squeegee job

Owner correction: a customer booking several different bins at one service property should receive **one Squeegee job for all bins that are emptied on the exact same date**, PROVIDED their frequency (four-weekly vs one-off), recurring interval, and verified Squeegee round/job-group also match. For example, Brown and Black on 16 November 2026 become ONE £10 four-weekly Squeegee job with two service UUIDs; Brown on 16 Nov and Black on 17 Nov become TWO jobs. If three bins split 2+1 across those dates, create two jobs with respectively two services and one service. One-off Brown and recurring Black on the same day stay two jobs because a Squeegee job has one recurrence.

The new pure grouping module is `netlify/functions/lib/squeegeeJobGrouping.js`. It runs AFTER price, website date, account service/round and bank-holiday recurrence validation, but BEFORE any Squeegee write. It never merges different dates or schedules, never drops a service, never invents a UUID, and sums verified per-line prices in integer pence, preserving the seven-for-six discount and original bin quantities in notes. The total of all grouped job prices must exactly match the independently verified website booking total. Invalid or ambiguous groups are held with no Squeegee write.

The worker still atomically reserves **individual** active property+bin and property+bin+plan+date claims for every selected bin, even if a group generates one Squeegee POST. Before the grouped POST, it advances ALL of that group's claims to request_in_progress. If Squeegee returns an uncertain/partial result, the entire affected booking requires reconciliation and no automatic retry is attempted. The completed status reports `createdJobs` as the actual number of Squeegee jobs and `binServices` / `binsPerJob` separately to avoid misleading job counts.

This update is Preview 1 only on draft PR #77. Existing Squeegee jobs will not be retroactively merged or edited: the currently verified API workflow only creates new jobs. An existing customer adding a bin that should join a previously created job still needs an owner-reviewed update path rather than a second duplicate service.

### 30 October 2026 — Read-only investigation of held Green-bin booking

The owner reported accepted website booking `NBG-MVVCDC3D-83AB713D58` (one Green domestic four-weekly bin, £5) was missing from Squeegee. The admin confirmation email showed the PHONE field held a postcode instead of a telephone number.

Netlify observability confirmed the booking email handler returned HTTP 200 and the signed Squeegee auto-sync endpoint returned HTTP 202 at 19:04:58 UTC. HTTP 202 denotes durable queue acceptance, NOT actual customer/job creation.

A temporarily deployed **read-only**, exact-reference diagnostic queried the Preview 1 auto-sync status and the original private accepted-booking audit, then examined Squeegee customers exclusively with GET calls. It found:

- `stage=held_for_review`, reason `customer_match_ambiguous_or_incomplete`; whole-booking claim `not_found` (no customer/job POST was authorised).
- Full customer scan completed 19 pages. The precise matcher reason was `possible_existing_address`.
- One existing Squeegee record has the same postcode, house number and street line; its saved email does **not** match the accepted booking email. The submitted phone field is invalid (a postcode), so there is no trustworthy phone match.
- Therefore **do not automatically create a duplicate or attach the new Green job to an unverified existing account**. The owner must inspect the existing customer and reconcile the contact/address manually. Do not re-submit or replay this accepted reference.

The temporary diagnostic function and its GitHub Action were deleted after the aggregate evidence was retrieved. No customer PII or account UUIDs were printed, and no Squeegee API writes were made during diagnosis.

### Prevention and operational visibility

- The Preview 1 customer booking form now requires an 11-digit UK phone number (mobile or NI landline, normalised from +44/0044 if needed) before it creates an accepted booking. `sendBookingEmail.js` independently rejects invalid contact numbers with HTTP 422 **before** email, leaderboard scoring, acceptance claims or automatic Squeegee dispatch. The existing accepted Green booking is preserved and is **not retried**.
- When automatic Squeegee import is held or requires reconciliation, the Preview 1 worker now sends a **PII-free owner alert** using the existing Resend email sender to the configured `BOOKINGS_TO` inbox (received with Zoho Mail). It includes booking reference, hold reason and any safe match-reason code, and instructs the owner to check the original admin booking email. Provider failure does not change the Squeegee hold or permit a retry. The alert is for NEW held bookings; it does not retroactively resend alerts for the historical Green booking.
- Exact street and house identity alone is not permission to reuse a Squeegee customer when submitted email and phone cannot be verified. Continue to hold ambiguous cases. A later owner-reviewed reconciliation must explicitly confirm the correct existing record before any new Squeegee job is created.
- Regression tests cover UK landlines/mobiles, rejecting postcodes, hold alerts, ambiguous match diagnostics and the existing no-write protections. Production, Preview 2 and draft PR #77's unmerged status remain unchanged.

## 30 October 2026 — Owner-approved exact name and address matching

Owner clarified that the previous held Green-bin submission was a **diagnostic test only**, not a request to replay it or manually attach its job. Future Preview 1 bookings must treat a **unique matching full customer name + exact service address (including postcode)** as an existing Squeegee account even when the submitted email AND phone differ from the old Squeegee details.

Implementation in `squeegeeCustomerMatcher.js`: case/whitespace-normalise the name and postcode/street abbreviation-normalise the **full** address; exact property + exact name selects one existing customer without requiring email/telephone. Existing email/phone/external-reference matching remains supported. If two customers share the same name/address, if another same-property customer matches the new contact details, or if the house number/postcode matches but the street differs, **hold for review**; never guess or create a duplicate. Revalidate authoritative `GET /customers/:id` address and, when matched by name, the customer's name before creating a job. Existing Squeegee contact, billing, payment and job details are not overwritten; append only an eligible, nonduplicate new-bin job.

### Deactivated customer limitation

The owner requests automatic customer reactivation for exact-name/exact-address matches. Squeegee's app publicly supports **Activate** in its customer three-dot menu (release note 1.54.13, 24 March 2026). However, the current public API v3 documentation at `https://api02.sqgee.com/api/v3/docs` (GET-checked unauthenticated on 30 October 2026) contains **no customer activation or reactivation operation**, and the verified API integration only has customer GET, create and add-job POST. Do NOT invent an undocumented PUT/PATCH/POST endpoint or assume creating a job reactivates a customer.

For now a uniquely identified `inactive`/`deactivated` customer becomes `reactivation_required`, not a new customer. The worker verifies the real account, records `held_for_review` with `existing_customer_reactivation_required`, sends the existing booking owner's PII-free review alert to the Zoho-facing inbox, and sends **no create-customer or add-job POST** or claims. A stale listing that says inactive but whose authoritative GET now says active may proceed normally after normal duplicate checks. Deleted/archived/cancelled records still hold. Enable automatic reactivation **only after Squeegee publishes/confirms a supported public API endpoint and its permissions, and after separately testing atomic, idempotent status updates**. This capability is not falsely marked as complete.

The held Green test `NBG-MVVCDC3D-83AB713D58` remains held; new matching logic will only apply to new accepted bookings. There is **no automatic replay or manual Squeegee write** for the old test. This change is restricted to draft PR #77 on Preview 1; no merge, live site or Preview 2 changes.

## 30 October 2026 — Duplicate email and address flags on new Preview 1 bookings

Owner requested that duplicate customer information be **flagged**, especially reused emails and addresses, without treating every repeated value as an error. This is implemented for accepted bookings processed by the Preview 1 automatic Squeegee worker, not a historical bulk-deduplication/deletion job.

**Full-page customer scan** — `squeegeeCustomerMatcher.matchCustomersAcrossPages` now includes matches from all verified customer pages for same full BT postcode, exact external reference, email (case-insensitive) and normalized UK phone. It deduplicates records by Squeegee `_id`. The additional `duplicateFlags` are **diagnostic only**; they neither rewrite the owner-approved name/address matching rule nor allow bypassing the actual customer, bin, date, and CAS duplicate protections. When customer pagination fails, do not claim a complete duplicate scan.

**Informational flags** (private, no PII in emails, logs or status data): email already registered, same email used at another service property, multiple records using one email, address already registered, same address under a different name, multiple accounts at the same address, same customer name/address but changed contact, possible nearby/variant address, phone already registered, phone used at another property.

**Example outcomes:**

- Matching full name, email **and** phone at a new verified address: reuse one existing customer and post the new job with an explicit `jobAddress`; leave the customer's original address and payment setup untouched. A unique identity must be verified against the authoritative customer details first.
- Matching email alone at a different address: signal it, but do **not** automatically merge different people or landlords. Ambiguous multiple identities or existing conflicting accounts are held for manual review.
- Existing cross-property jobs with the same bin service cannot safely be disambiguated if Squeegee omits their job addresses on readback: hold rather than risk duplication. Website-created active-bin claims remain per property.
- Same full customer name and same full address, but new email/phone: flag the changed contact and reuse the existing verified Squeegee customer; never overwrite their stored contact details.
- Exact address already registered under a DIFFERENT name, no corroborating contact: flag and **hold**; don't assign another person's job to that record.
- Same property and one selected bin already has a job: hold as before; duplicate flags do not permit a second job.
- Duplicate names/contacts across multiple possible Squeegee customer IDs: hold as before. Do not select an arbitrary account.

**Owner notifications** — `squeegeeSyncOwnerAlert.js` sends ONE PII-free informational email for a completed booking with any duplicate flags, containing only the booking reference and human-readable flag names, to the configured bookings inbox received in Zoho Mail. Held/uncertain bookings include flags in the existing review-alert email (no duplicate extra alert). The owner-only `/api/squeegee-preview-auto-status` page displays the same flags after authorisation. Public/customer booking forms do NOT disclose the existence of another person's email/account/address (privacy). A missing email provider or failed informational alert never changes the recorded booking outcome or retries any Squeegee write.

The change runs exclusively in draft PR #77 on Preview 1; no Squeegee records were touched to implement or test the detector. All tests use fake data; a real incoming Preview 1 booking would be needed to verify the live notifications. Historical Squeegee customers are only examined when a new booking runs, not proactively purged or merged. Production and Preview 2 stay unchanged.

## 30 October 2026 — Existing-customer Blue-bin hold: real job-service object format

Accepted website booking `NBG-MVVEKILD-31F3D9F612` for one Blue four-weekly bin at the existing `TEST API - Fresh Sync` address (`34 Ballycrochan Avenue`) was queued via signed endpoint (HTTP 202) but not imported. One-time read-only, exact-reference status inspection confirmed `stage=held_for_review`, reason `cannot_inspect_existing_jobs`, and `claimState=not_found`: the worker stopped **before any Squeegee customer or job POST**, while checking the already-existing Brown job. Duplicate email/phone/address flags were informational, not the cause.

**Verified real Squeegee response shape:** authenticated GET `/api/v3/public/customers/:id` returned `jobs` as an array with one existing job. That job exposes `services` as an array of OBJECTS (`[{_id,description,quantity}]`), not plain string UUIDs. A second authenticated **GET-only** check independently confirmed its Brown service `_id` exactly matches the Brown service ID from the Squeegee services catalogue (boolean equality only; no IDs or personal details exposed). The fake tests initially used bare string UUIDs, so the worker's `overlappingJobs` method falsely held every existing customer with real service data.

**Correction:** `squeegeeAutomaticBooking.js` now accepts each existing job service as either the verified real object (`_id` required; optional `id` must not disagree), or a bare UUID for backwards compatibility. Every extracted UUID is validated using `api.requireUuid` before duplicate comparison. All existing recurring and one-off service UUIDs for requested colours are included, so an existing Blue job STILL blocks a duplicate Blue booking, while an existing Brown-only job permits a distinct new Blue job on the same verified customer. Malformed or unidentified service objects continue to fail closed before any Squeegee POST.

**Safety:** the original Blue booking stays held and MUST NOT be automatically retried. This change affects future eligible bookings on Preview 1 only; no live/Preview 2 changes. Added regression tests mimic real Squeegee GET object shapes, duplicate and cross-plan detection, malformed service failure, and preserving the original Brown job. This is not a retroactive merge or job-edit workflow.


## 30 October 2026 — Safe same-colour quantity handling (Preview 1)

**Verified public Squeegee API limitation:** the AddJobBody allows `services: UUID[]` and a total price but does not document per-service quantities. Existing customer job GET responses can contain `quantity`, but the exposed public API key does not offer a verified endpoint to edit a job or increase that quantity. Repeating service IDs or adding an invented quantity field is not a safe substitute.

- Any new booking requesting multiple physical bins of one colour (e.g., 2 Brown at £10 every four weeks, a one-off booking of 2 Brown, or an otherwise valid seven-for-six discount) is accepted by the normal website but **held from Squeegee auto-sync** as `service_quantity_requires_manual_configuration`. The worker records a private status and sends a PII-free owner action-required alert with the requested bin quantities. It creates **no** customer or job and takes **no** Squeegee write claims; the owner must configure the correct quantity, price, round and recurrence manually.
- A booking at an existing customer's property for an already-registered bin colour is held as `existing_job_for_selected_bin_requires_review`. The owner must verify whether the customer means another physical bin or an accidental duplicate, then adjust the existing job manually if necessary. Previous jobs, billing methods and appointments remain unchanged.
- Two different colours with quantity 1 each can still be automatically grouped when their exact date, round and recurrence match. If **any** line in a booking has quantity greater than one, the **whole** Squeegee import is held, preventing an incomplete customer or unrelated partial jobs.
- `squeegeeJobGrouping.js` also refuses plans with quantities other than one, so later code cannot bypass the initial guard and silently undercount bins. The booking confirmation displays a manual-verification notice for quantity >1, and the protected owner status page displays the reason and sanitised bin quantities.
- Original website/admin email bookings remain intact. No automatic retry or replay should be performed for held bookings. True automatic additional-bin quantity updates require a documented job-update or per-service quantity API from Squeegee, matching key permissions, and a controlled end-to-end test.
- Draft PR #77 and Preview 1 only; no code changes to Production/main or Preview 2 and no live Squeegee customer/job writes in this change.
