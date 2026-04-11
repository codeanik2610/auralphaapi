# Risk Center Phase 7

Date: 2026-04-09

## 1) Goal
Phase 7 for `/risk-center` closes the remaining operator-trust and maintainability debt that was still visible after Phase 6 release gating.

By the end of this phase the risk-center workspace should:

- stop treating `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx` as the only place where overview, policy, drawer, and operations UI can live
- surface recent risk activity inside `/risk-center` instead of immediately forcing operators into `/activity`
- advertise the real page structure and handoff behavior in the `/risk/overview` contract metadata

## 2) What Changed
### Frontend workspace split
The Risk Center page in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
now hands rendering to focused modules:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/trust.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterOverviewWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterOperationsWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterActivityTrail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskPolicyDrawer.jsx`

That split keeps page-level orchestration in the route while moving bulky rendering into explicit overview, policy, operations, activity, and drawer concerns.

### In-page risk activity trail
`/risk-center` now surfaces filtered risk activity directly inside the configured-policy workspace.

That trail:

- uses `/activity` route plus `referenceId` filters instead of inventing a second audit source
- stays scoped to the selected policy when one is active
- preserves the existing handoff into `/activity` for deeper investigation

### Contract metadata
The `/risk/overview` contract now advertises the new Phase 7 truth in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/RiskOverview.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts`

The metadata now states that:

- risk activity trail rendering is part of the page truth
- the workspace uses focus, coverage, policy, and activity modules instead of one undifferentiated page surface
- the selected-rule drawer and history flow remain canonical for policy lifecycle work

## 3) Phase 7 Outcome
`/risk-center` is still one route, but it no longer behaves like one giant render surface.

Operators can now:

- move through the workspace from focus and coverage into policy and activity without leaving the page
- review recent policy-linked risk events inside the selected-rule workflow
- trust that the backend contract describes the current page structure instead of an earlier implementation

## 4) What Remains
Phase 7 does not add a new approval workflow beyond the existing `auto_approved` lifecycle.

The next reasonable follow-up for `/risk-center` is:

- manual approval or review states for policy lifecycle when governance requires more than auto-approval
- deeper activity filtering or retention controls if risk audit volume grows

## 5) Verification
Phase 7 verification passed with:

- `npm run test:risk-center-contract`
- `npx eslint src/api/contracts/RiskOverview.ts src/api/services/RiskOverviewService.ts scripts/test-risk-center-contract.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/RiskCenter/index.jsx src/pages/RiskCenter/index.test.jsx src/pages/RiskCenter/trust.js src/pages/RiskCenter/RiskCenterActivityTrail.jsx src/pages/RiskCenter/RiskCenterOverviewWorkspace.jsx src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx src/pages/RiskCenter/RiskCenterOperationsWorkspace.jsx src/pages/RiskCenter/RiskPolicyDrawer.jsx tests/e2e/risk-center.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/risk-center.spec.js`
- `npm run release-gate:risk-center`
