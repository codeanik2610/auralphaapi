# Risk Center Phase 9

Date: 2026-04-09

## 1) Goal
Phase 9 makes the in-page `/risk-center` activity trail operational.

By the end of this phase, operators should be able to stay inside the selected-rule workflow, filter the recent risk feed by stream and posture, queue an export from that exact trail state, and understand export retention before handing off into the broader Activity workspace.

## 2) What Changed
### Backend overview contract
`/risk/overview` now returns a dedicated `activityTrail` block in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/RiskOverview.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts`

That contract now exposes:

- default risk-route filters for the in-page trail
- supported filter controls for `stream`, `status`, and `readState`
- export posture such as `exportFormat`, `exportHistoryPath`, and retention labels
- the most recent export created from the risk route so the page can show truthful export state

The Phase 9 overview metadata also now states that:

- the selected-rule workspace uses in-page trail filters and export controls
- export history is part of the page truth
- `riskActivityTrailFiltersUsedByPage` and `riskActivityTrailExportsUsedByPage` are supported capabilities

### Focused backend verification
Risk Center backend coverage now locks the Phase 9 trail truth in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-contract.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase2.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase9.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-risk-center.ts`

That verification now checks:

- the Phase 9 contract version and summary text
- the presence of `activityTrail` in the overview payload
- supported filter options and export metadata
- latest risk-export selection and retention labeling
- dedicated Phase 9 coverage through `npm run test:risk-center-phase9`

### Frontend trail controls
The Risk Center UI now uses the Phase 9 trail contract in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/riskCenterSlice.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterActivityTrail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/trust.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/risk-center.spec.js`

The UI now:

- stores `activityTrail` from `/risk/overview`
- lets operators filter recent risk activity by stream, status, and read state
- queues an export from the currently selected risk trail posture
- surfaces the latest export state and retention window directly in the in-page trail card
- preserves existing handoff links into `/activity` and alert-related workflows

## 3) Phase 9 Outcome
`/risk-center` now has an operational recent-activity workspace instead of a read-only teaser.

Operators can:

- narrow the selected-rule risk feed without leaving the page
- export the exact trail posture they are inspecting
- see whether the latest export is queued, ready, or expired
- understand the retention window before moving into the Activity export workspace

## 4) What Remains
Phase 9 still uses a lightweight trail posture rather than a fully persisted saved view.

The next reasonable follow-up is:

- add saved filter presets or URL persistence for the in-page trail posture
- add export ownership, retention overrides, or escalation hooks if governance around exports becomes important
- add richer server-side filtering if the trail grows beyond the current route-focused operator view

## 5) Verification
Phase 9 verification passed with:

- `npm run test:risk-center-phase9`
- `npm run test:risk-center-contract`
- `npm run test:risk-center-phase2`
- `npm run type-check`
- `npx eslint src/api/contracts/RiskOverview.ts src/api/services/RiskOverviewService.ts src/api/services/BrokerPositionsFacadeService.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase2.ts scripts/test-risk-center-phase9.ts scripts/release-gate-risk-center.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/riskCenterSlice.js src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx src/pages/RiskCenter/RiskCenterActivityTrail.jsx src/pages/RiskCenter/trust.js src/pages/RiskCenter/index.test.jsx tests/e2e/risk-center.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/risk-center.spec.js`
- `npm run release-gate:risk-center`
