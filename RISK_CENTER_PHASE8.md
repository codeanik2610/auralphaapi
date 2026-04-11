# Risk Center Phase 8

Date: 2026-04-09

## 1) Goal
Phase 8 adds policy governance to `/risk-center`.

By the end of this phase, sensitive policy changes should no longer become effective immediately. Operators should be able to submit them for review, inspect the pending version in the same drawer workflow, and explicitly approve or reject the change before enforcement moves.

## 2) What Changed
### Backend governance workflow
The risk-policy contract, controller, validator, repository, and service now support manual review for sensitive lifecycle mutations in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Risk.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/RiskController.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/risk.validator.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/RiskPolicyRepository.ts`

That workflow now adds:

- `pending_review`, `approved`, and `rejected` policy-version states
- explicit approve and reject endpoints for pending versions
- policy-level governance metadata such as `pendingVersionId`, `pendingVersionCount`, `approvalMode`, and `approvalState`
- manual-review submission for sensitive updates and rollbacks instead of silently applying them

### Overview contract truth
`/risk/overview` now advertises the Phase 8 governance truth in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/RiskOverview.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts`

The metadata now states that:

- the selected-rule workspace includes pending-review history controls
- policy governance is part of the page truth
- `policyReviewWorkflow` is a supported capability

### Frontend review workflow
The Risk Center UI now treats pending review as part of the normal selected-rule lifecycle in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/riskCenterSlice.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/trust.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskPolicyDrawer.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx`

The UI now:

- keeps the drawer open on sensitive saves and pivots directly into History
- shows pending-review state on the selected rule and version history
- lets operators approve or reject a pending change without leaving `/risk-center`
- keeps rollback available for approved historical snapshots

## 3) Phase 8 Outcome
`/risk-center` now has an actual policy governance loop instead of an auto-approve-only lifecycle.

Operators can:

- submit a stricter or otherwise sensitive policy change without applying it immediately
- review pending snapshots in the same drawer where they already inspect lifecycle history
- approve or reject the pending version and then watch the selected-rule card refresh to the effective state

## 4) What Remains
Phase 8 still treats new policy creation as immediately approved.

The next reasonable follow-up is:

- introduce role-based governance or multi-step approval if policy ownership requires separation of duties
- add retention, filtering, or escalation controls to the risk activity trail as governance volume grows

## 5) Verification
Phase 8 verification passed with:

- `npm run test:risk-center-phase8`
- `npm run test:risk-center-contract`
- `npm run test:controllers`
- `npx eslint src/api/contracts/Risk.ts src/api/contracts/RiskOverview.ts src/api/controllers/RiskController.ts src/api/services/RiskService.ts src/api/services/RiskOverviewService.ts src/api/validators/risk.validator.ts src/database/repositories/RiskPolicyRepository.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase2.ts scripts/test-risk-center-phase8.ts scripts/test-controllers.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/riskCenterSlice.js src/services/tradingApi.js src/pages/RiskCenter/index.jsx src/pages/RiskCenter/trust.js src/pages/RiskCenter/RiskPolicyDrawer.jsx src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx src/pages/RiskCenter/index.test.jsx tests/e2e/risk-center.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/risk-center.spec.js`
- `npm run release-gate:risk-center`
