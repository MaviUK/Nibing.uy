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
