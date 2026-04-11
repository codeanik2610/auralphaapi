# Risk Center Phase 6

Date: 2026-04-09

## 1) Goal
Phase 6 for `/risk-center` focuses on release readiness and final sign-off.

By the end of this phase the page should:

- have a risk-center-specific release gate that proves the backend contract, frontend UI, and browser journey still hold
- support a live health probe against the real `/risk/overview` and `/risk/alerts/overview` endpoints with explicit latency and truthfulness thresholds
- have a final sign-off script that records whether operators have reviewed dashboards, provenance, handoffs, and migration evidence

## 2) What Changed
### Backend operational tooling
The backend now includes risk-center rollout scripts in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-risk-center-health.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-risk-center.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-risk-center.ts`

Those scripts add:

- a live `/risk/overview` plus `/risk/alerts/overview` probe using API key or admin login credentials
- configurable thresholds for overview latency, alerts latency, total latency, policy count, broker count, and capability truth
- a JSON release-gate artifact at `artifacts/risk-center-release-gate.json`
- a final sign-off artifact path compatible with `artifacts/risk-center-signoff.json`

The package entry points are wired in
`/Users/apple/Documents/Project/Backend/aurAlpha/package.json`.

### Frontend sign-off coverage
The frontend now has a browser-level operator journey in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/risk-center.spec.js`.

That flow verifies:

- `/risk-center` loads as an authenticated operator surface
- policy save changes are persisted back into the selected-rule view
- policy history rollback restores an older rule snapshot through the real drawer workflow
- policy and enforcement activity links preserve route context into `/activity`
- alert handoff preserves symbol context into `/alerts`

### Repo tracking
The rollout tracker and README now include the Phase 6 baseline and risk-center gate commands in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/README.md`
- `/Users/apple/Documents/Project/Backend/aurAlpha/PRODUCTION_READINESS_TRACKER.md`

## 3) Phase 6 Outcome
`/risk-center` now has a full implementation-to-release path:

- trusted backend correctness and truthfulness from earlier phases
- focused UI and E2E regression coverage
- release-gate automation
- live health thresholds
- final sign-off automation

This is the point where `/risk-center` stops being “feature-complete” and becomes “promotion-ready.”

## 4) Operational Note
The live risk-center health probe still requires a running API plus either:

- `APP_API_KEY` or `API_KEY`
- or valid admin login credentials

The final sign-off script expects real environment evidence through env vars before an actual promotion. Local placeholder values verified the automation wiring in this Phase 6 pass, but they are not a substitute for real staging or production evidence.

## 5) Verification
Phase 6 verification passed with:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint tests/e2e/risk-center.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/risk-center.spec.js`
- `npm run release-gate:risk-center`
- `RISK_CENTER_SIGNOFF_GATE_FILE=artifacts/risk-center-release-gate.json RISK_CENTER_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED=true RISK_CENTER_SIGNOFF_DATA_PROVENANCE_VERIFIED=true RISK_CENTER_SIGNOFF_OPERATOR_HANDOFFS_VERIFIED=true RISK_CENTER_SIGNOFF_MIGRATION_RUN_VERIFIED=true npm run signoff:risk-center`
