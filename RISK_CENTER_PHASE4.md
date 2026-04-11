# Risk Center Phase 4

Date: 2026-04-09

## 1) Goal
Phase 4 for `/risk-center` focuses on policy lifecycle.

The page should no longer behave like a single mutable form with no history. Operators need to see
how a rule changed, restore a prior persisted snapshot, and follow policy changes through the
activity trail that enforcement uses.

## 2) What Changed
### Policy version history is now a first-class API
Risk policies now expose persisted history instead of requiring operators to infer change history
from the current row only.

Backend additions:

- `GET /api/v1/risk/policies/:policyId/versions`
- `POST /api/v1/risk/policies/:policyId/rollback`

Updated backend files:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Risk.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/RiskController.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/risk.validator.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/RiskPolicyRepository.ts`

Each version item now carries:

- lifecycle operation: `create`, `update`, or `rollback`
- summary and optional operator reason
- approval metadata
- changed-field labels
- rollback eligibility
- stored policy snapshot
- direct activity and enforcement activity links

### Lifecycle metadata is now explicit
Policy writes and rollbacks now store structured lifecycle payloads instead of only persisting raw
request bodies.

Phase 4 semantics:

- current approval mode is `auto_approved`
- current approval state is `approved`
- lifecycle metadata is persisted so a future manual-approval workflow can layer onto the same
  version model without redefining the contract

This keeps the product honest: Phase 4 adds lifecycle visibility now, while deferring a full
approval queue until there is a real operational need for it.

### Rollback is now a supported operator action
Operators can now restore a prior saved policy snapshot from the Risk Center history tab.

Rollback behavior:

- rollback requires a concrete historical `versionId`
- rollback cannot target the already-current version
- rollback reuses the stored snapshot, then writes a new `rollback` version entry describing what
  was restored
- duplicate-target protections from Phase 1 still apply during rollback

### Activity linkage is clearer
Policy lifecycle and enforcement outcomes now line up more cleanly in activity.

Phase 4 linkage improvements:

- policy writes and rollbacks log activity with the policy id as the reference id
- enforcement outcomes now prefer the policy id as the activity reference when a policy was part of
  the risk decision
- the frontend can open both policy-history activity and enforcement activity directly from the
  selected rule and from each version card

### `/risk-center` now exposes lifecycle UX
The selected rule card and policy drawer now support lifecycle-aware operator flow.

Frontend updates:

- selected rule card now exposes `History`, `Policy activity`, and `Enforcement activity`
- drawer now includes a `History` tab for existing policies
- history tab shows saved versions, lifecycle summaries, approval mode, changed fields, and key
  snapshot values
- rollback targets now expose a `Restore snapshot` action

Updated frontend files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/riskCenterSlice.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`

### Overview metadata now tells the truth about rollback
`/risk/overview` now advertises `policyRollback: true`, and the overview contract version is now:

- `risk-center-phase4-2026-04-09`

This prevents the frontend contract metadata from lagging behind the actual lifecycle capability.

## 3) Phase 4 Outcome
`/risk-center` now has a usable policy lifecycle baseline.

Operators can inspect saved versions, understand what changed, restore a previous rule snapshot,
and follow the same policy through both configuration activity and enforcement-side activity. The
approval model is still intentionally simple, but the contract is now ready for stronger workflow in
the future.

## 4) Known Carry-Forward For Phase 5
- broader end-to-end coverage is still needed for policy save, rollback, and activity-link flows
- release hardening still needs migration hygiene validation in real environments
- manual approval, draft, or multi-step review states are still deferred beyond the current
  `auto_approved` lifecycle model
- kill switch automation, capacity, and meaningful recompute remain outside the trusted operator
  lifecycle

## 5) Verification
Phase 4 verification passed with:

- `npm run test:risk-center-phase4`
- `npm run test:risk-center-contract`
- `npm run test:risk-center-phase2`
- `npm run test:controllers`
- `npx eslint src/api/contracts/Risk.ts src/api/controllers/RiskController.ts src/api/services/RiskService.ts src/api/validators/risk.validator.ts src/database/repositories/RiskPolicyRepository.ts src/api/services/BrokerOrdersFacadeService.ts src/api/services/RiskOverviewService.ts scripts/test-controllers.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase1.ts scripts/test-risk-center-phase2.ts scripts/test-risk-center-phase4.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/RiskCenter/index.jsx src/pages/RiskCenter/index.test.jsx src/store/slices/riskCenterSlice.js src/services/tradingApi.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx`

The focused backend and frontend suites passed. The UI run may still print the existing React
Router future-flag warnings.
