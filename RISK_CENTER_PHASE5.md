# Risk Center Phase 5

Date: 2026-04-09

## 1) Goal
Phase 5 for `/risk-center` focuses on release hardening.

By the end of this phase the page should not just support policy lifecycle workflows in the happy
path. We also need stronger regression proof for:

- policy save and rollback dispatch flows in the UI
- activity-link handoffs from the selected rule workflow
- order-enforcement audit linkage when risk blocks or warns on a trade
- migration-chain hygiene around the risk-center table removals, restores, and policy-target
  hardening

## 2) What Changed
### Backend hardening suite
The backend now has a focused Phase 5 regression suite in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase5.ts`

That suite verifies:

- blocked orders log risk-control activity against the effective `policyId`, emit the expected risk
  alert, and never reach broker execution
- warning-only pre-trade breaches still log the policy-linked warning activity before order
  creation continues
- the remove/restore/hardening migration chain still executes the expected risk-center schema
  operations
- duplicate normalized risk-policy targets still fail the hardening migration before the unique
  index is created

The package script is now wired in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/package.json`

with:

- `npm run test:risk-center-phase5`

### Frontend regression coverage
The focused `/risk-center` UI suite in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.test.jsx`
now covers the operator actions that matter most after Phase 4:

- selected-rule activity navigation
- selected-rule enforcement activity navigation
- saving an existing policy from the drawer
- restoring a saved policy snapshot from History and refetching policy history

This means the lifecycle UI is now regression-locked around operator intent, not only around static
rendering.

### Runtime behavior
Phase 5 did not change the trusted `/risk-center` API contract or add new user-facing capabilities.

Instead, this phase strengthens the proof around the Phase 4 runtime:

- lifecycle flows remain intact
- audit linkage remains policy-aware
- risk migrations have an explicit regression check

## 3) Phase 5 Outcome
`/risk-center` now has a stronger promotion baseline.

The page already supported lifecycle work after Phase 4. Phase 5 makes that support safer to carry
forward by locking the operator flows, enforcement activity linkage, and migration assumptions into
repeatable regression checks.

## 4) Known Carry-Forward For Phase 6
- `/risk-center` still does not have a dedicated release gate or final sign-off automation
- migration hygiene is now regression-tested in code, but a real target-environment migration run is
  still required before promotion
- browser-level operator journey coverage for save, rollback, and activity handoffs still does not
  exist
- manual approval, draft, and multi-step policy review remain deferred beyond the current
  `auto_approved` lifecycle model

## 5) Verification
Phase 5 verification passed with:

- `npm run test:risk-center-contract`
- `npm run test:risk-center-phase1`
- `npm run test:risk-center-phase2`
- `npm run test:risk-center-phase4`
- `npm run test:risk-center-phase5`
- `npm run test:controllers`
- `npx eslint src/api/contracts/Risk.ts src/api/controllers/RiskController.ts src/api/services/RiskService.ts src/api/services/BrokerOrdersFacadeService.ts src/api/services/RiskOverviewService.ts src/api/validators/risk.validator.ts src/database/repositories/RiskPolicyRepository.ts src/database/migrations/1763800000000-RemoveRiskCenterTables.ts src/database/migrations/1763800001000-RestoreRiskCenterTables.ts src/database/migrations/1770600000000-HardenRiskPolicyTargetIntegrity.ts scripts/test-controllers.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase1.ts scripts/test-risk-center-phase2.ts scripts/test-risk-center-phase4.ts scripts/test-risk-center-phase5.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/RiskCenter/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx`

The focused UI suite passed with only the existing React Router future-flag warnings.
