# Login Phase 5

Phase 5 closes the auth verification and release-safety gap so Phase 6 can build on a measurable baseline instead of ad hoc checks.

## What is now in place

- Backend auth health snapshot at `GET /api/v1/health/auth` for admin bearer tokens or API-key callers.
- Live auth health script in [`scripts/check-auth-health.ts`](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-auth-health.ts).
- Auth release gate in [`scripts/release-gate-auth.ts`](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-auth.ts).
- Auth final sign-off script in [`scripts/signoff-auth.ts`](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-auth.ts).
- Frontend auth E2E coverage in [`tests/e2e/auth.spec.js`](/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/auth.spec.js).
- Focused frontend auth UI regression coverage in [`src/services/http.test.js`](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/http.test.js) and [`src/helpers/authRouting.test.js`](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/authRouting.test.js).

## Gate scope

`npm run release-gate:auth` now verifies:

- backend auth contract tests
- backend auth security tests
- backend type-check
- frontend auth lint
- frontend auth UI suite
- frontend auth Playwright suite
- optional live auth health check when `AUTH_RUN_LIVE_CHECKS=true`

`npm run check:auth-health` now enforces:

- secure auth config validation
- login throttling enabled
- seed-account policy aligned to the environment
- active lockout thresholds
- active failed-login window thresholds
- observability failure alerts enabled when required

## Verified baseline

Phase 5 was verified with:

- `npm run test:auth-security`
- `npm run type-check`
- `npm run test:ui -- src/helpers/authRouting.test.js src/components/auth/RequireAuth.test.jsx src/components/auth/GuestOnlyRoute.test.jsx src/pages/Login/index.test.jsx src/services/http.test.js`
- `npm run test:e2e -- tests/e2e/auth.spec.js`

## Phase 6 handoff

Phase 6 can assume:

- login, session-expiry redirect, and invalid-credential UX are covered by E2E
- auth transport retry/redirect behavior is covered in unit tests
- backend auth posture has a callable health endpoint and scripted thresholds
- release sign-off can point to a single auth gate artifact instead of separate manual command runs

Carry-forward risk:

- logout and logout-all still revoke refresh tokens only; already-issued access tokens remain valid until access-token expiry because there is still no denylist
