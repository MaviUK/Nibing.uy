# Preview 77 — Production Squeegee booking readiness (6 November 2026)

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
| `SQUEEGEE_PRODUCTION_API_KEY` | **Missing: obtain a separately scoped real production Squeegee key from the owner** |
| `SQUEEGEE_PRODUCTION_EVENT_SECRET` | high-entropy independently generated Functions-only secret |
| `SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET` | separate high-entropy Functions-only secret |

Do not use the Preview 77 branch-specific Squeegee key in `SQUEEGEE_PRODUCTION_API_KEY`. The owner status sign-in can be activated independently while writes are OFF. Its one-time codes go only to `info@nibing.uy`.

## Release acceptance: first WITHOUT Squeegee creation

1. On Preview 77, run the fake-only `node --test tests/squeegee-*.test.cjs` and `npm run build` CI gate; prove production gate rejects preview scope and missing/paused flags.
2. Check on Preview 77 that `/api/squeegee-production-auto-sync` and `/api/squeegee-production-auto-status` both return **404**. Production-only endpoints are intentionally not exercisable from a preview host.
3. On a controlled prelaunch **production-context** deployment, with every write switch OFF, submit one real form booking from the live domain and confirm customer email + owner email + attached signed Terms PDF; verify **no Squeegee customer or job created**. Record the booking reference and reconcile it manually. Do not use a fictitious customer on an actual live public form without owner control.
4. Configure the production API key only in the production Functions context; verify GET-only service/customer lookup and the read-only owner OTP status page without enabling writes.
5. Inspect Netlify Blob CAS reservation, runtime production scope and the emergency pause before setting `ATOMIC_LEDGER_READY=true`.
6. **Only after explicit owner approval**, enable one controlled transaction and verify new customer, existing customer/new colour, duplicates/inactive holds, additional same-colour quantity, 660/1100L, valid round/first clean/4-week recurrence, signed owner PDF, no duplicate receipts and no retries after ambiguous POST. Compare Squeegee account directly and owner email.
7. Set `WRITES_PAUSED=true` to prove the emergency kill switch works. Confirm an owner can find held/reconciliation references; do not automatically replay them. Explicitly approve any final go-live change.

**Important:** Installing code on Preview 77 does NOT configure the live key, turn on automatic creation, perform a real booking, or publish to production. A Preview 77 form may still use its pre-existing *preview-specific* integration; do not mistake that separate pilot for a production-off test.
