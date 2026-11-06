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
