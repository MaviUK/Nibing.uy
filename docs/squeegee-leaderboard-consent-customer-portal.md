# NI Bin Guy customer portal and permission-based leaderboard — 1 November 2026

## Current preview implementation

The existing N64 preview is PR #77 on `preview/n64-retro-site`. Production main remains unchanged.

- Owner-approved first-name source: a **private** CSV created locally from `customers_PRIVATE.csv` joined to the 31 October Squeegee streak-scoring mapping by immutable customer UUID. Exactly 941 active, non-deleted customers with qualified historical scores, totalling 808,316 historical XP. No private first name or raw customer reference was added to public GitHub.
- The private CSV is `NI_Bin_Guy_First_Name_Town_Consent_PRIVATE_2026-11-01.csv` (conversation artifact). Each customer is **pending**, never pre-consented. 333 single-word account names and five ambiguous/business-like account names need verification.
- Owner-only management: `/api/squeegee-preview-leaderboard-names`, protected by the existing Preview 1 email-code session. Imports the private CSV into private Netlify Blob `n64-preview1-arcade-leaderboard-names-private`. The CSV UUID is validated against the existing internal alias and historical town/points, but **not stored** in this Blob. Each record retains only the private Squeegee reference, safe first name, town, internal pseudonymous alias, name-review category and consent evidence metadata.
- A stored grant requires an individually chosen Squeegee reference, positive owner confirmation, a consent-evidence identifier, and a method (verified email reply, signed form or documented call). The record captures UTC timestamp and exact disclosure notice version. Withdrawal can be recorded on the owner page and takes effect on the next public API request.
- Before the first private import, the existing public NBG-generated-reference leaderboard remains as it was. Once a first-name list is imported, the N64 public leaderboard **fails closed** to consent-only mode: no customer without a recorded grant appears publicly. All customers keep their historical points privately.
- The public `arcadeLeaderboard` JSON only returns first name (when proven consented), town, points and an opaque internal player reference for stable UI behaviour; it never returns the customer's Squeegee reference, full name, contact details, consent evidence or UUID. The public N64 UI shows **first name · town · XP**. The separate owner-only HTML preview file is not a public website.
- Expired active-status backups still hide the scores after seven days. Squeegee historical-score increments still require additional APIs or a fresh owner backup. A customer’s consent is not proof that an inactive account can be displayed.
- File imports are staged by the owner. The current Netlify plugin cannot directly upload the private CSV into the Blob store; the owner must use the signed-in upload form. **No names were published automatically.**

## Custom customer portal feasibility

Official Squeegee API: https://api02.sqgee.com/api/v3/docs (7 currently documented endpoints in the Preview 1 adapter). API early-access blog: https://squeeg.ee/blog/post/api-access .

**Available now:**
- Look up a customer by `GET /customers`, `GET /customers/:id`, or `GET /customers/external-id`. Customer records may include a summary of existing jobs and service assignments.
- Read service and job-group catalogues.
- Create customers and add jobs with the currently restricted POST endpoints, respecting existing booking idempotency and verified scheduling rules.
- Build custom portal authentication (separate to Squeegee) using email magic links or OTP, and tie login to verified private Squeegee UUIDs.
- Show private streak/XP from imported Squeegee backup and verified website XP. Provide opt-in/withdrawal for first-name public board. Show rota-based expected cleaning date only where the website's own schedule is verified.

**Not available in currently documented Squeegee endpoints:**
- Read historic completed appointments and paid invoice/payment records for true live loyalty points.
- View billing balance, invoices or make payments through a documented API.
- Edit/reschedule/cancel/reactivate existing customer jobs via API; offer an owner-review request until official endpoints exist.
- Subscribe to Squeegee invoice/payment/attendance webhooks.

**Recommended portal MVP:** secure customer email sign-in; account and service details; estimated/verified next clean; private XP and current streak; rewards; add-bin booking via existing booking flow; leaderboard consent and withdrawal; owner-managed change requests. Connect billing, appointment adjustments and fully automated points after Squeegee publishes/permits the required API operations.

**Security:** never expose the Squeegee API key to the browser. Authenticate every portal request and authorise it against the verified Squeegee customer UUID; avoid lookup by unverified email/name/postcode. Keep consent logs and withdrawals private. Offer appropriate privacy notices and assess PECR before contacting legacy customers with marketing requests.

ICO consent guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/how-should-we-obtain-record-and-manage-consent/


## 1 November 2026 — owner change: registered email is required for leaderboard eligibility

The owner explicitly instructed that customers **without a valid email in Squeegee are not counted on the leaderboard**. This supersedes previous wording that all 941 historical ranked records should appear publicly. Historical points themselves are retained privately; a later verified Squeegee email update can make the customer eligible.

Source: private 31 October 2026 Customer HQ JSON, independently reconciled to the public-safe historical snapshot:

- **1,022** active non-deleted Squeegee accounts in the private file.
- **293** accounts have no usable email. **729** have a valid registered email.
- Of the 941 historical accounts with positive points and a verified town, **662** have an email (**519,442** total historical streak XP), **279** have no email (**288,874** historical XP retained privately, not ranked).
- **Four** of the 662 ranked accounts share **two** email addresses with other active accounts. They qualify on the email-present criterion but cannot use self-service sign-in until the identity conflict is resolved securely. No wrong account may be selected.
- Public first-name leaderboard is additionally **consent-gated**. Before each eligible customer's permission is recorded, that customer is **not displayed publicly**, and \`totalPlayers\` denotes the count actually opted in. Aggregate \`eligiblePlayers\` may report 662 separately; no PII is disclosed.
- **No unfiltered 941-player public fallback** is permitted in the exact Preview 1 hostname when the private Customer HQ eligibility import is missing. The API returns an empty \`eligibility_pending\` response instead. This is intentional fail-closed behaviour: do not display customers who might have no email.
- After owner uploads \`NI_Bin_Guy_Customer_HQ_Secure_Import_PRIVATE_2026-10-31.json\` to \`/api/squeegee-preview-hq-import\`, the server reads a private Blob to compute the list of allowable pseudonymous aliases; this allowlist is never committed to GitHub and no customer email is sent to the public browser.
- Owner grant screen now checks the same private allowlist and refuses granting a public leaderboard entry to an account with no email. Withdrawal remains supported.
- Customer point history for no-email accounts is not discarded; the original 20/22/24 scoring, skipped-clean reset and website-XP join are unchanged. A separate authenticated Squeegee account verification remains mandatory before private data is shown.

Preview branch \`preview/n64-retro-site\` / draft PR #77 only. No Squeegee API writes and no Production changes. No private customer file was uploaded automatically.

