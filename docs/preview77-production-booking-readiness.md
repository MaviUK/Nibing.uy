# Preview 77 — Production Squeegee booking readiness (6 November 2026)

**Canonical N64 test/release branch:** Preview 77, not release PR #80. Preview 77 now incorporates the latest live `main` history and reconciled 5 November aggregate paid-service quantities while retaining its first-name, town and XP leaderboard. The separate PR #80 is an earlier production-hardening reference; its production Customer HQ and opt-in-gated live leaderboard features are not yet integrated into Preview 77. Before launching live, a production identity and consent release gate must be reviewed without altering Preview 77's test leaderboard. No merge to `main` is approved.

**Owner permission verification (6 November 2026):** Owner confirms that every customer with a registered email has personally responded **yes** to displaying their first name, town and XP. The original positive replies are retained in Zoho Mail. The owner-only Preview 77 permissions page now offers a one-time, audited batch confirmation for the currently imported email-eligible customers. This is NOT a blanket ongoing consent for newly added accounts; accounts without a verified email or a usable first name remain excluded from recorded public-name permission, and prior opt-outs are never overridden. Customer HQ already permits direct email-code-authenticated withdrawal without changing private cleaning history. The bulk confirmation only takes effect after the owner signs in to the private page and submits the form; adding the code does not write to private Netlify Blobs. No live production publication without a separate final release check.\n\nThis branch is a **Deploy Preview only**, not an approved production release. It retains Preview 77's current leaderboard/customer-facing code and its separate preview API integration. **Never merge or publish to `main` without owner approval.**

## What is now staged in code

- Production-only signing/dispatch: `squeegeeProductionDispatch.js`.
- Exact live host, Netlify production context and site-ID checks: `squeegeeProductionGuard.js`.
- Independent Squeegee v3 API client: `squeegeeProductionApi.js`.
- Strong-consistency immutable one-time booking/status ledger: `squeegeeProductionAutoSync.mjs`.
- Verified original signed Terms PDF and a single owner success/hold notification.
- Read-only owner status and reconciliation page with mailbox-only one-time code: `squeegeeProductionAutoStatus.mjs`.
- The existing booking email sender calls the production dispatcher **only** if every production flag is explicitly enabled. In all other cases, the existing email-only route remains in effect. Preview 77's own pilot stays independent.

## Launch switches — keep OFF while testing

These must be Netlify **production context only**, server-side Functions scope, never `VITE_*` or repository text:

| Key | Prelaunch value |
| --- | --- |
| `SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED` | `false` |
| `SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES` | `false` |
| `SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY` | `false` until live CAS verified |
| `SQUEEGEE_PRODUCTION_WRITES_PAUSED` | `true` |
| `SQUEEGEE_PRODUCTION_API_KEY` | Configured as a production-only Functions secret; same Squeegee credential as preview by owner request |
| `SQUEEGEE_PRODUCTION_EVENT_SECRET` | high-entropy independently generated Functions-only secret |
| `SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET` | separate high-entropy Functions-only secret |

The owner has explicitly approved reuse of the same Squeegee credential in a separate production-only secret. This does not grant the preview production write rights. The owner status sign-in can be activated independently while writes are OFF. Its one-time codes go only to `info@nibing.uy`.

## Release acceptance: first WITHOUT Squeegee creation

1. On Preview 77, run the fake-only `node --test tests/squeegee-*.test.cjs` and `npm run build` CI gate; prove production gate rejects preview scope and missing/paused flags.
2. Check on Preview 77 that `/api/squeegee-production-auto-sync` and `/api/squeegee-production-auto-status` both return **404**. Production-only endpoints are intentionally not exercisable from a preview host.
3. On a controlled prelaunch **production-context** deployment, with every write switch OFF, submit one real form booking from the live domain and confirm customer email + owner email + attached signed Terms PDF; verify **no Squeegee customer or job created**. Record the booking reference and reconcile it manually. Do not use a fictitious customer on an actual live public form without owner control.
4. Configure the production API key only in the production Functions context; verify GET-only service/customer lookup and the read-only owner OTP status page without enabling writes.
5. Inspect Netlify Blob CAS reservation, runtime production scope and the emergency pause before setting `ATOMIC_LEDGER_READY=true`.
6. **Only after explicit owner approval**, enable one controlled transaction and verify new customer, existing customer/new colour, duplicates/inactive holds, additional same-colour quantity, 660/1100L, valid round/first clean/4-week recurrence, signed owner PDF, no duplicate receipts and no retries after ambiguous POST. Compare Squeegee account directly and owner email.
7. Set `WRITES_PAUSED=true` to prove the emergency kill switch works. Confirm an owner can find held/reconciliation references; do not automatically replay them. Explicitly approve any final go-live change.

**Important:** The production-only key is stored, but automatic creation is still disabled, production read-only access is OFF, no real production booking has been tested, and the live site has not been changed. A Preview 77 form may still use its pre-existing *preview-specific* integration; do not mistake that separate pilot for a production-off test.

## Pre-launch website findings — audit update 6 November 2026

- **Coverage/SEO:** Millisle and Portaferry remain `review` in the canonical postcode policy and are **not** automatically bookable. Until the owner confirms service coverage, the search sitemap and homepage service JSON-LD exclude them; each existing town page is a noindex, clearly marked availability-check page. Do not silently move either town into `activeTowns`.
- **Booking emails:** Recent historical customer/owner booking pairs in Resend show delivered status and a matching signed Terms PDF attachment. This does **not** substitute for an approved final production booking/email test.
- **Stats:** The 1,734 monthly-customer count is owner-reported. The historical 5 November verified bin total remains separate from the owner-estimated 200-bin weekday display progression; do not misrepresent planning targets as audited records.
- **Performance:** The sampled Preview 77 Netlify P90 was approximately 2.87 s for Customer HQ (32 requests) and 2.53 s for the public leaderboard (34 requests). The new release candidate reduces sequential Netlify Blob GETs and defers the external Squeegee widget until the portal section is near view. Re-measure after warm and cold traffic; do not claim a quantified speed-up from static tests.
- **Accessibility:** A keyboard-focusable Skip to main content link targets the actual homepage landmark. The older accessibility PR's static embedded widget was already replaced, but a dynamically embedded third-party Squeegee portal remains further down the homepage. Test that widget and dialogs with a real mobile screen reader rather than assuming third-party accessibility is solved.
- **Mobile:** A real Samsung/Android booking, postcode autocomplete, scrolling/anchors, stage animation, error recovery, Customer HQ email-code session and withdrawal flow still require hands-on testing. Automated unit tests and builds are not a replacement.
- **404s:** Immutable Netlify deploy URLs may show 404s when copied between deployments. Check the canonical `deploy-preview-77--nibinguy.netlify.app` route independently before reporting an actual Customer HQ outage.
- **Approval:** Remain on Preview 77. Do not merge into `main` or activate production Squeegee writes until the owner authorises it.

## Production Customer HQ and leaderboard release gates — 6 November 2026

The launch artifact remains **Preview 77 (PR #77)**. The live domain must use its own production-only controls rather than the preview hostname. This code is staged but the production flags are **OFF** until the owner accepts the release.

- Production Customer HQ accepts only the trusted Netlify production context with hostname `nibing.uy`, the existing site ID, independent `N64_PRODUCTION_CUSTOMER_HQ_SECRET`, `N64_PRODUCTION_CUSTOMER_HQ_ENABLED=true` and `SQUEEGEE_PRODUCTION_READ_ENABLED=true`. Its Squeegee account check uses the isolated read-only production client, never preview write grants.
- Production public scores use `/api/n64-production-leaderboard` and additionally require `N64_PRODUCTION_LEADERBOARD_ENABLED=true` plus an independent `N64_PRODUCTION_PUBLIC_LEADERBOARD_SECRET`. The output includes **only explicitly evidenced, unwithdrawn** opt-in first names, towns, XP and opaque public references. Pending accounts cannot be published; the preview continues its existing test presentation.
- The production flags are presently both `false`, and `SQUEEGEE_PRODUCTION_READ_ENABLED=false`. Real Squeegee writes remain independently paused. Enabling public rankings alone cannot create customers or jobs.
- The signed private score import and consent cohort are read from existing site-local Netlify Blobs stores. The owner must verify the 5 November history and consent evidence against these private stores **before** enabling the live features. Never infer consent merely from a registered email; do not publicly release a missing or mismatched ledger.
- A verified backup can be displayed for up to 35 days with its source date and an explicit historical-data note. New imports still require a source no older than seven days. Withdrawal remains available during the brief display grace. This is only continuity for delayed imports, **not** an automatic Squeegee sync. Plan a weekly owner-reviewed upload.
- The privacy policy now explains how names, towns, consent, rewards and server-side private storage work. Confirm the final published text and retention practices with the owner.
- The £12,000/4-week planning model implies **150 planned charged bins/day**; the separate public running estimate is **200 physical bins/day Mon–Thu**, including work not yet in Squeegee. These figures are not interchangeable and no extra 50/day are marked as paid.
- **Netlify key handling review required:** Some existing unmasked-in-configuration variable records (`RESEND_API_KEY`, `RECAPTCHA_SECRET_KEY`, `BLOBS_TOKEN`) are not marked as secret, and the production Squeegee key reports multiple deploy contexts. Netlify does not let an existing variable's secret flag/scope be changed through an upsert. Correct these securely in Netlify without exposing values, interrupting mail, or using a preview key as a replacement.
- Preview-only functions providing owner imports or test sessions remain deliberately preview-only. Do not expose them under the production host.
- Before launch: real Samsung booking/autocomplete/scroll/animation/OTP/withdrawal, cached and uncached performance benchmark, read-only production Squeegee check, final signed PDF + owner/customer email, one explicitly approved real booking test, and verification of the owner-review/kill-switch path.
- Do **not** merge to `main` or enable the producer without explicit owner approval. No public customer consent or private history is stored in GitHub.

## Owner upload HTTP 413 mitigation — 6 November 2026

Two owner POST requests to `/api/squeegee-preview-hq-import` at 18:54 and 18:55 UTC returned HTTP 413. The user's 6 November `.sqg` backup is a ~30.9 MB 7z archive containing a ~349.9 MB JSON database, NOT the validated Customer HQ import format. The private owner form requires the already generated ~2.31 MB `NI_Bin_Guy_Customer_HQ_Secure_Import_PRIVATE_2026-11-05_PER_BIN.json` file, previously provided in the owner's private ChatGPT files. The 5 Nov file has not been reimported or replaced by this change.

The owner form now constrains file selection to JSON, explains the difference, and uses a same-origin external script with strict CSP to stop oversized and `.sqg` submissions **before** the browser posts them. Server-side OTP, CSRF, JSON schema/reconciliation, 3 MB source cap, and 3.5 MB multipart cap remain in place. No raw customer backup was stored in the repository; Netlify imports are owner-initiated and private. A new backup can only be used after separately preparing and validating a new private Customer HQ JSON. The failure alone does not indicate that Customer HQ or the leaderboard API is broken.

## Normal Squeegee .sqg upload — automated conversion pilot (6 Nov 2026)

Preview 77 owner import form accepts the normal weekly Squeegee .sqg archive (sample: 30,853,639 compressed bytes, ~349,898,053 bytes uncompressed). A single large multipart upload exceeded Netlify's buffered request limit and returned 413. The new owner-only workflow runs a pinned LGPL 7-Zip WebAssembly decoder locally in a browser worker, reads the Squeegee backup's customer, transaction, invoice and job-occurrence rows, reconciles physical bin quantities and paid/streak dates, then uploads ONLY the reduced Customer HQ JSON through the same validated owner OTP/CSRF server endpoint. The raw archive never passes through a Netlify function, GitHub, or a public leaderboard API. No extra CSV/JSON needs to be manually prepared by the owner.

**Important safeguards:** Names and towns are reused from the previously verified private snapshot when available; newly active addresses with ambiguous town stay "Town unavailable" and aren't published. Full payment uses paid occurrence + paid invoice, or an invoiced occurrence on a customer account whose signed Squeegee transaction balance is zero/credit. Unpaid/uncertain cleans get 0 XP; recorded skips reset the 4-week streak. Multiple services and quantities contribute individual physical bins at a single service-day streak level. A verified 6 Nov archive must reconcile to 26,039 paid physical bins, otherwise the import stops without replacing existing history. Records are owner-only and the private consent ledger preserves prior grants and withdrawals subject to the existing identity/town checks.

**WASM:** `public/vendor/sqg-7zip/7zz.es6.js` is the pinned open-source 7-Zip browser decoder with its licence in the same directory. Its associated `7zz.wasm` module is downloaded over HTTPS from the exact upstream Git commit `521d2cf93f5964f4e77b01049e19f1b29305c454` when an owner processes a backup. The archive data is never sent to that provider. The converter uses a Web Worker so the UI remains responsive. If the module cannot load or extraction/validation fails, the old scores stay untouched. Maximum supported .sqg size 65 MB and expanded JSON 500 MB. Mobile performance and browser memory still require a real Samsung test before declaring this production-ready.

**Live website is unchanged.** Owner consent still needs to have been independently recorded: the mere presence of an email is not consent. Weekly imports on the preview update scores after the owner selects the backup; the live production activation still requires explicit approval.

## 6 November 2026 — Security, booking and mobile release gates

- **Secrets audit:** The dedicated Squeegee production credential is marked secret and Functions-only, with a nonempty value for production and blank overrides in preview/dev. Automatic production writes OFF, explicit owner approval OFF, atomic write ledger not ready, emergency pause ON. No credential was copied into source control.
- **7 November security correction:** `RESEND_API_KEY`, `RECAPTCHA_SECRET_KEY`, `NETLIFY_EMAILS_SECRET` and `SQUEEGEE_PRODUCTION_API_KEY` are marked secret. Production Squeegee credentials have Functions-only scope with a nonempty production context and blank nonproduction overrides. The obsolete token-like Netlify variable name has been deleted; it did not match the currently configured Resend credential. `BLOBS_TOKEN` remains unprotected with broad scopes. A guarded replacement via the Netlify management API returned HTTP 422 and left the existing token intact, to avoid disrupting bookings. Set `BLOBS_TOKEN` to Secret, preferably Functions-only, in the Netlify UI while retaining its exact value; redeploy safely and verify storage. Separately audit and rotate any still-active previously exposed Resend key at the provider, after confirming it is unused. Removing the Netlify variable does not revoke a provider-side API key.
- **GET-only production Squeegee check:** The production owner status page now includes a private services/job-groups connectivity check. It explicitly requires `SQUEEGEE_PRODUCTION_READ_ENABLED=true`, `SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED=false`, `SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES=false`, `SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY=false`, `SQUEEGEE_PRODUCTION_WRITES_PAUSED=true` and the exact production runtime. Preview 77 cannot execute it against production credentials by design; it requires an owner-approved safe-mode production deployment.
- **Booking safeguards:** Existing tests cover signed PDF and original SHA-256 certificate, date/round mapping, duplicate claims, ambiguous POST no replay, and owner alerts for holds, inactive customers and quantity reviews. Synthetic checks are not proof of an approved production booking.
- **Mobile:** Added safe Android-emulation Playwright smoke with screenshots of homepage and booking/coverage dialogs. No booking is submitted. It is not a substitute for a hands-on Samsung session.
- **Speed:** Previous sampled preview-77 Netlify p90: leaderboard about 1.71 seconds (107 requests), Customer HQ about 2.72 seconds (91), homepage about 1.37 seconds (13). These measure request latency, not full browser loading.
- **Owner sign-off:** No `main` merge or production automatic booking activation until outstanding credential work, owner-authorised read-only production test, signed PDF/email and controlled booking acceptance, and Samsung checks are complete.

## 7 November 2026 — Millisle and Portaferry coverage reconciliation

The owner's 31 October active four-weekly route snapshot includes Portaferry (Round 11, Monday Week 3) and Millisle (Rounds 12 and 14 in Week 3, and Round 17 in Week 4). Their previous `review-only` flags contradicted that active schedule. Preview 77 now classifies both as active and makes the postcode checker use local centres for their villages. Only an **exact council-confirmed address** with matching postcode, bin collection dates and four-weekly town schedule may receive automatic booking dates. Unknown council addresses remain review-only, and the separately removed towns (Greyabbey, Ballywalter, Portavogie, Cloughey and Ballyhalbert) remain blocked.

Service links, active town pages, sitemap and search structured data now match these rounds. The two previously noindex review pages are replaced by service pages but still say that address/date availability is checked before allocating the first clean. Do not automatically extend coverage to neighbouring villages or use a town name alone to assign a job. This is a Preview 77 change only; the live website and Squeegee production-write controls remain unchanged. The owner should confirm the current route assumptions before final release.

## 7 November 2026 — Security changes, evidence and safe rollback checkpoint

**Canonical release is PR #77 (`preview/n64-retro-site`).** PR #80 is not the approved source. Do not merge or publish without owner approval. The live Netlify production deploy remains unchanged.

### Flags checked directly in Netlify

- Automatic production writes OFF (`SQUEEGEE_PRODUCTION_AUTO_SYNC_ENABLED=false`, `SQUEEGEE_PRODUCTION_OWNER_APPROVED_WRITES=false`, `SQUEEGEE_PRODUCTION_ATOMIC_LEDGER_READY=false`, `SQUEEGEE_PRODUCTION_WRITES_PAUSED=true`).
- GET-only production access is enabled (`SQUEEGEE_PRODUCTION_READ_ENABLED=true`), but the authenticated production-context connectivity test and controlled booking have not been performed.
- Production Customer HQ and public leaderboard remain OFF (`N64_PRODUCTION_CUSTOMER_HQ_ENABLED=false`, `N64_PRODUCTION_LEADERBOARD_ENABLED=false`). They may be enabled only after the shared private history, evidence-backed consent and withdrawal flow have been verified.
- `BLOBS_TOKEN` still needs secret/scope correction in Netlify. A redeploy and a safe storage smoke test are needed after the change.

### Private history and consent

1. Owner must inspect `/api/squeegee-preview-hq-import` for the actual active history date, physical paid-bin totals and XP. The 6 November import expects 26,039 paid physical bins; an HTTP 200 upload does not alone verify the recorded totals.
2. Owner must inspect `/api/squeegee-preview-leaderboard-names` for the presence of a consent ledger and positive reply evidence, preserving withdrawal records and excluding unverified customers.
3. Verify public Overall/2024/2025/2026 rankings against signed-in Customer HQ. A 35-day historical display grace is not an automatic Squeegee refresh; keep weekly owner-reviewed backup imports.

### Final deployment and rollback

1. Record the current live `main` commit and production deploy ID. Preserve a current read-only copy of private customer history and consent data. A Netlify site rollback does not undo any Squeegee jobs already created.
2. Deploy to production with writes OFF and emergency pause ON. Verify signed Terms PDFs, customer and owner emails, and the authenticated GET-only Squeegee services/job-group check. Verify zero Squeegee writes.
3. Only after separate owner approval, reconcile a single real production booking with Squeegee; check existing-customer match, inactive/duplicate holds, same-colour quantities, correct rounds/dates and owner attention alerts; prove the kill switch.
4. Complete a real Samsung/Android booking, autocomplete, Customer HQ OTP, permission withdrawal and slow-network test. Automated safe browser simulation and fake-only CI tests are not substitutes.

**Status:** Preview 77 is mergeable and the current build/tests pass; external security and production acceptance work still block a safe release.
