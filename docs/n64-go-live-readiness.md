# NI Bin Guy — N64 release candidate cutover gates

**Status: PREPARATION ONLY — DO NOT MERGE OR PUBLISH TO PRODUCTION YET.**  
Review date: 4 November 2026. Release branch: `release/n64-go-live-prep`.  
Live production is `https://nibing.uy`; the working API integration remains on preview PR #77.

## Reconciled merge

- The main branch had **one** commit after the common ancestor; it changed only `src/data/statsPlan.js` and set monthly customers to **1,734**.
- The N64 preview already imports `OWNER_MONTHLY_PLAN.monthlyCustomers`, where the confirmed figure is **1,734**. Retain the preview's reconciled physical-bin counting rather than live's old time-based fictitious completed-washes counter.
- The release branch contains a merge commit with both main and preview as parents. Main and Preview 1 have **not** been modified or merged.
- Release CI must independently pass the fake-only Squeegee suite and the Vite website build on every release change.
- This release includes 200+ modified/additional files, so test complete booking, portal, navigation and legacy admin routes before accepting the PR.

## Production admission groundwork (4 November, 22:00 UTC)

- Added `netlify/functions/lib/squeegeeProductionGuard.js` with a **separate** exact-production host/context/site gate, production-only API and event secret requirements, owner approval, CAS ledger readiness and an independent emergency pause switch.
- Each production setting must be explicitly enabled: `SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED=true`, `SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES=true`, `SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY=true`, `SQUEEGEE_PRODUCTION_WRITES_PAUSED=false`, with properly scoped `SQUEEGEE_PRODUCTION_API_KEY` and `SQUEEGEE_PRODUCTION_EVENT_SECRET`. Their **absence keeps production OFF**. These variables have **not** been configured.
- Added fake-only tests for production/preview hostname isolation, missing switches and secrets, immutable production booking claims, signed-event tampering/expiry and emergency pause. Automated build gate runs them with all other `squeegee-*.test.cjs` tests.
- **This is only the safety foundation.** No production Squeegee event receiver, durable status storage, owner review/inbox or approved POST capability has been deployed. Never treat the guard alone as completed wiring; production live imports remain **disabled**.

## Blocker: production Squeegee automatic booking

- Netlify's existing **production** context currently has **no Squeegee API key**. The Preview 1 branch has its own branch-scoped key. This separation must remain until owner-approved activation.
- `lib/squeegeeApiV3.js`, `lib/squeegeeAutomaticBooking.js`, `lib/squeegeePreviewAutoDispatch.js`, and `squeegeePreviewAutoSync.mjs` are intentionally hard-gated to the **exact Preview 1 host/context/site**. Merging them unchanged would NOT make live automatic booking operational.
- Before cutover, implement **separate production-specific** origin, runtime-context/site verification, production-scoped HMAC signing, independent durable idempotency claims/status storage, a rollback/kill switch, and an owner-visible production reconciliation/status page. Production writes must be OFF by default; enabling must require explicit owner sign-off and Functions-scoped secret.
- Do **not** remove the preview-only guard to make production work. Do **not** turn on a generic deploy-preview write flag. Do **not** copy or expose keys in the repository.
- Verify using a controlled real booking: new customer, existing customer/new bin, duplicate and ambiguous address, inactive customer, 2+ same-colour bin quantity, 660/1100L if supported, correct first clean/round/recurrence, and one correct owner email with signed PDF. Never automatically replay uncertain or partially created jobs. Reconcile legacy held test records manually.

## Blocker: Customer HQ and rankings on live

- `customerHQ.mjs` accepts only Preview 1 runtime context; the private snapshot, OTP/session, consent and imported scoreboard currently use preview-namespaced stores.
- Build a **production-only** authenticated read path using separate private stores; use fresh owner-authorised Squeegee import and correct email identity checks. Maintain existing shared-email holds, private XP separation, security throttling and opt-in/withdrawal evidence. Do not publicly carry over simulated Preview 1 permissions.
- The stored history was derived from a 31 October 2026 Squeegee backup and does not sync paid cleans automatically. Before public release, refresh active/deleted statuses and scoring from a recent verified backup, enforce freshness expiry, and show source dates. Paid-clean API sync is unavailable in the current documented API.
- Production `arcadeLeaderboard.js` currently falls back to the older website board; yearly Squeegee/first-name rankings are **preview-only**. Confirm the owner-approved production consent policy and migration before enabling public first names.

## Confirmed / remaining infrastructure checks

- Netlify preview build and 635 fake-only integration tests passed on 4 November for the previous preview head; **rerun on this release branch**.
- Resend recent customer and internal owner receipts have matching signed Terms PDF attachments. Repeat one controlled complete booking and one held-booking review check on final production build before changing DNS/serving live.
- Google Places has server-side configuration for production; check actual API-key restrictions and postcode suggestions against `nibing.uy`, including addresses missing their postcode.
- Review Netlify secrets for least-privilege scopes and secret marking. The Squeegee key is context-scoped; do not put any secret into `VITE_*` or client code. Some unrelated service credentials are stored as non-secret environment variables and should be audited separately before launch.
- The active-town list treats Millisle and Portaferry as review-only even though historical rota data includes those locations. Obtain an owner decision before claiming coverage. Never add deleted Friday areas.
- The total-washed widget is backed by the 31 October Squeegee snapshot plus 14,000 earlier bins, **not a live API counter**. Clearly label the verification date; do not turn scheduled jobs into cleaned physical bins.
- Run mobile browser tests for postcode picker, accessibility, T&C scroll acceptance, postcode/round check, Google address autocomplete, page scroll, Squeegee portal link, Owner HQ and year-by-year XP.

## Activation and backout gate

1. Preserve a verified current **live** deploy and a database/Netlify Blob snapshot; do not change main during preparation.
2. Land all code fixes and secure production-only integration on this isolated release branch; CI all green, no PR conflicts.
3. Owner explicitly approves the final release candidate, exact customer-consent policy, test booking, and live Squeegee key deployment.
4. Publish only after a controlled acceptance test passes; keep a genuine operational stop switch for automatic jobs. If a new deploy fails, the previous live deploy stays published. For a bad published deploy, fix forward after switching off job creation rather than replaying bookings.

**Current decision:** merger prepared; production integration, fresh customer data/permissions, and live end-to-end verification are still outstanding. This document is a safety gate, not a claim that launch is already safe.
