# Preview 77 — Production Squeegee booking readiness (6 November 2026)

**Canonical N64 test/release branch:** Preview 77, not release PR #80. Preview 77 now incorporates the latest live `main` history and reconciled 5 November aggregate paid-service quantities while retaining its first-name, town and XP leaderboard. The separate PR #80 is an earlier production-hardening reference; its production Customer HQ and opt-in-gated live leaderboard features are not yet integrated into Preview 77. Before launching live, a production identity and consent release gate must be reviewed without altering Preview 77's test leaderboard. No merge to `main` is approved.

This branch is a **Deploy Preview only**, not an approved production release. It retains Preview 77's current leaderboard/customer-facing code and its separate preview API integration. **Never merge or publish to `main` without owner approval.**

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
