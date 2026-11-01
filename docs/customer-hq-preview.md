# Customer HQ — N64 Preview 1 initial implementation (1 November 2026)

**Branch:** `preview/n64-retro-site` / draft PR #77. **Production remains unchanged.** Never merge without separate owner approval.

## Goal and agreed flow

The public leaderboard shows ONLY consenting customers' **first name · town · XP**. Tapping a row opens `/customer-hq`. This is **not** authentication to the tapped row: the visitor signs in to their **own** active Squeegee account using an 8-digit emailed NI Bin Guy code. After login they see their **private** cleaning-by-cleaning points breakdown, and a separate button opens the site's existing embedded Squeegee customer portal at `/#customer-portal`. The Squeegee widget has its own separate login; there is no SSO available through currently documented Squeegee API endpoints.

The portal does NOT attempt invoice payments, editing/reactivating accounts, changing Squeegee jobs or reading undisclosed endpoints.

## Implemented on preview

- `src/pages/CustomerHQ.jsx`, `src/customer-hq.css`, `src/App.jsx`, and `netlify.toml`: sharp-edged N64 mobile interface, `/customer-hq` SPA route, progress/XP/streak/history display, email-code sign-in, public leaderboard opt-in or withdrawal, and an **OPEN SQUEEGEE PORTAL** button. Homepage portal section now links into Customer HQ without removing the original Squeegee widget.
- `netlify/functions/customerHQ.mjs` at `/api/customer-hq`: **Preview-1-only** API with an exact host/deploy/site gate; same-origin JSON POST, HttpOnly secure random session cookie, one-time eight-digit email codes (10-minute expiry, five attempts, ten-minute per-email issue throttle, 12-hour session); Resend uses existing `RESEND_API_KEY` and sender. The endpoint reads the **existing** `GET /api/v3/public/customers/:id` to confirm the account is currently active and its email matches the verified identity **before** emailing a code, granting login, or returning private data. It never exposes Squeegee credentials or customer UUIDs to the browser.
- `netlify/functions/lib/customerHQ.js`: private snapshot reconciliation, OTP secret domain separation, privacy-safe account projections, email normalization, one-time sessions and revocation, no guessing when two different Squeegee accounts share an email.
- `netlify/functions/squeegeePreviewCustomerHQImport.mjs` at `/api/squeegee-preview-hq-import`: uses the existing **owner OTP** (separate from the new customer OTP). Owner uploads the private 2 MB JSON. Strictly verifies 1,022 non-deleted active backup accounts, 941 ranked history accounts with 808,316 streak points, 20/22/24 event consistency, unique Squeegee immutable IDs and customer refs, and backup date. Writes to a dedicated **private** Netlify Blob only; no customer names, contact details, events or UUIDs are placed in GitHub or exposed by the public leaderboard.
- The same private import initialises 941 pending/unticked leaderboard consent entries in a separate **private** Netlify Blob if not already initialised. This makes the public leaderboard fail closed: no first names or alias entries are public until individual permission is recorded. Existing manual consent choices are retained. Customers can opt in themselves after email-code authentication, correct their first name, or withdraw and retain their earned points.
- Public leaderboard rows and homepage portal section now link to `/customer-hq`, never pass a selected row's reference/UUID to the login endpoint.
- Squeegee's embedded portal remains intact. The new portal does not create Squeegee customers or jobs or alter the verified booking API integration.
- Existing server-side verified website XP can be included in the **private** account total where there's an unambiguous private Squeegee UUID link, otherwise website XP is zero/pending verification.

## Owner action REQUIRED before sign-in can work

1. Download `NI_Bin_Guy_Customer_HQ_Secure_Import_PRIVATE_2026-10-31.json` (2 MB; contains customer emails and historical clean events) from the private ChatGPT-generated artifact. **Never commit it to GitHub or publish it online.**
2. Open `https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-hq-import` from your phone browser, request the existing owner's emailed access code, and upload that JSON in the secure owner-only form.
3. Test your own active Squeegee customer account using `https://deploy-preview-77--nibinguy.netlify.app/customer-hq`. The customer login requires the email currently registered on that **same** Squeegee record. Do not test with an unrelated customer's email.

The private upload was **not** performed automatically; the Netlify connector currently cannot write arbitrary blobs. No customer sign-in email has been sent on behalf of the owner.

## Data and limitations

Source is the **31 October 2026 backup**. It includes 1,022 active customer records, 941 ranked accounts (808,316 public-eligible historical cleaning XP), 950 active accounts with positive paid-clean history, and 23,280 private verified clean/skip events for active accounts (810,172 cleaning XP across all active accounts). Of the 1,022 accounts, **729** have a valid email address; **two emails belong to two accounts each**, so four customers are held from self-service until reviewed; **293** have no usable email. At most **725 unique-email customers** could potentially use email-code login after the private import and Squeegee API confirmation. The portal never merges shared-email accounts by guessing.

The private breakdown contains date, event, awarded XP and streak. A recorded skipped Squeegee occurrence resets the next bonus to 20. Completed unpaid/unverified cleans earn zero until reconciled. **History does not update automatically**: there is no documented Squeegee endpoint that reads full completed-clean and payment history. Show the date of the imported snapshot and use a fresh, verified owner import to refresh.

Production readiness still requires owner validation of email-code delivery, live Squeegee GET shape, privacy notice/lawful basis, customer communications/PECR and portal protections. This is a **preview implementation**, not a claim of GDPR compliance or a tested production customer-login rollout.

## Regression tests

`tests/squeegee-customer-hq.test.cjs` tests OTP hashing, expiry, retry cap, one-time use, shared-email hold, active account/email verification, private response redaction, and session revocation. Run `node --test tests/squeegee-*.test.cjs` and `npm run build` in preview. CI workflows have both as required checks.
