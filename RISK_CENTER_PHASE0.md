# Risk Center Phase 0

Date: 2026-04-09

## 1) Problem Statement
AurAlpha already has a protected `/risk-center` route, backend risk endpoints, and policy
configuration writes, but the current implementation mixes three different product stories:

- a latest-snapshot risk digest
- a policy configuration workspace
- a partially live broker-risk console

Phase 0 exists to freeze what `/risk-center` is for, which backend endpoints the page is allowed to
depend on, what each policy mode means, and which values are snapshot-backed vs config-backed vs
currently unavailable before Phase 1 starts changing enforcement and UX semantics.

## 2) Ownership Boundary
Frontend ownership lives in `/Users/apple/Documents/Project/Frontend/aurAlphaApp`:

- route registration: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`
- page UI: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
- page test: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.test.jsx`
- risk-center state:
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/riskCenterSlice.js`
- API call wiring:
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`

Backend ownership lives in this repo:

- overview controller:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/RiskOverviewController.ts`
- alerts-overview controller:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/RiskAlertsOverviewController.ts`
- policy + base risk controller:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/RiskController.ts`
- overview services:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskAlertsOverviewService.ts`
- core risk service:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskService.ts`
- validation:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/risk.validator.ts`
- contracts:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Risk.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/RiskOverview.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/RiskAlertsOverview.ts`
- persistence:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/RiskSnapshot.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/RiskPolicy.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/RiskPolicyVersion.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/RiskRepository.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/RiskAlertRepository.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/RiskControlRepository.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/RiskScenarioRepository.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/RiskPolicyRepository.ts`

Phase 1 may change page layout, copy, loading behavior, and enforcement alignment, but it should
preserve the product decisions below unless frontend and backend are updated together.

## 3) Product Decision
`/risk-center` is an operator risk workspace, not a canonical live risk engine and not a full
approval workflow.

That means:

- the page is allowed to combine latest snapshot-backed risk posture with policy configuration data
- snapshot sections are informative digests, not proof of live broker state
- policy rows are part of the configuration system of record
- the page may navigate operators to source pages such as `/alerts`
- the page must not present unavailable or derived-only values as authoritative live telemetry

Phase 0 explicitly freezes these semantics for future work:

- effective policy precedence is `broker-specific enabled policy` ->
  `enabled user-default policy` -> `no active policy`
- `monitor only` means record/watch only and never block execution
- `warn` means execution is allowed but the action should be surfaced as a warning when the rule is
  evaluated
- `hard block` means execution should be rejected when an implemented rule breach occurs
- duplicate user-default rules and duplicate broker rules are invalid configuration, even though the
  current backend does not yet enforce that centrally

## 4) Current End-To-End Data Flow
1. An authenticated user lands on `/risk-center`.
2. The frontend mounts `RiskCenterPage`.
3. The page dispatches:
   - `fetchRiskOverview({ controlsLimit: 10, alertsLimit: 10, scenariosLimit: 10 })`
   - `fetchRiskAlertsOverview({ limit: 10, offset: 0 })`
4. `GET /api/v1/risk/overview` fans out to:
   - latest risk summary from `risk_snapshots`
   - paged `risk_controls`
   - paged `risk_scenarios`
   - paged `risk_alerts`
   - all `risk_policies`
   - connected broker-account keys
   - active broker definitions for display-name mapping
5. `GET /api/v1/risk/alerts/overview` separately returns:
   - paged risk alerts
   - aggregate alert counts by severity and status
6. The frontend renders:
   - summary KPIs from `summary`
   - risk windows from `summary.drawdownBudgetUsed` plus selected policy thresholds
   - broker cards from broker keys + policy state + optional summary broker-status hints
   - configured-policy table and drawer from `policies`
   - controls, scenarios, and alerts tables from the overview payload
7. Clicking an alert row navigates to `/alerts` filtered by symbol.
8. Saving a policy calls:
   - `POST /api/v1/risk/policies` for create
   - `PUT /api/v1/risk/policies/:policyId` for update
9. The backend validates numeric ranges, writes `risk_policies`, and appends a
   `risk_policy_versions` row.
10. The frontend refetches both overview endpoints after save.

## 5) Frozen Page Truth Model
Phase 0 freezes the meaning of each major section:

- summary metrics
  - latest snapshot digest
  - not live broker telemetry
- risk windows
  - policy-threshold framing over latest snapshot usage
  - only daily usage is currently backed by a snapshot field
- broker KPIs
  - connected-broker policy coverage summary plus optional backend status hints
  - wallet/open-position values are not part of the current backend overview contract
- configured policies
  - configuration system-of-record surface
- risk controls
  - latest persisted snapshot-derived checks
- risk scenarios
  - latest persisted scenario rows
- risk alerts
  - latest persisted snapshot-derived alerts plus a secondary aggregate summary endpoint

## 6) Frozen Query Contract
### `GET /api/v1/risk/overview`
Supported query params:

- `controlsLimit`
- `controlsOffset`
- `alertsLimit`
- `alertsOffset`
- `scenariosLimit`
- `scenariosOffset`

Default behavior:

- section defaults are `limit=10`, `offset=0`
- paging is section-specific

Explicitly unsupported for this endpoint:

- `brokerKey`
- `accountId`
- `status`
- `scope`
- `sort`
- `order`

### `GET /api/v1/risk/alerts/overview`
Supported query params:

- `limit`
- `offset`
- `status`
- `scope`

Default behavior:

- `limit=10`
- `offset=0`

Explicitly unsupported for this endpoint:

- `brokerKey`
- `accountId`
- `severity`
- `sort`
- `order`

### `GET /api/v1/risk/policies`
Supported query params:

- none

### Policy write scope
Supported scopes:

- `user`
- `broker`

Deferred from Phase 0:

- `account`
- workspace/global scopes

## 7) Frozen Response Contract
`GET /api/v1/risk/overview` now returns the existing section payloads plus a `meta` block that
freezes query support, section provenance, and known capability flags.

Response shape:

```json
{
  "success": true,
  "data": {
    "meta": {
      "contractVersion": "risk-center-phase0-2026-04-09",
      "purpose": "operator_risk_workspace",
      "generatedAt": "2026-04-09T10:00:00.000Z",
      "query": {
        "supported": [
          "controlsLimit",
          "controlsOffset",
          "alertsLimit",
          "alertsOffset",
          "scenariosLimit",
          "scenariosOffset"
        ],
        "unsupported": ["brokerKey", "accountId", "status", "scope", "sort", "order"],
        "resolved": {
          "controls": { "limit": 10, "offset": 0 },
          "alerts": { "limit": 10, "offset": 0 },
          "scenarios": { "limit": 10, "offset": 0 }
        }
      },
      "sources": {
        "summary": "risk_snapshots_latest",
        "controls": "risk_controls",
        "scenarios": "risk_scenarios",
        "alerts": "risk_alerts",
        "policies": "risk_policies",
        "brokers": "connected_broker_accounts_plus_active_definitions"
      },
      "capabilities": {
        "policyWrites": true,
        "policyRollback": false,
        "liveBrokerKpis": false,
        "riskCapacity": false,
        "killSwitchAutomation": false,
        "recomputeExecutesRealCalculation": false
      }
    },
    "summary": {},
    "controls": {},
    "scenarios": {},
    "alerts": {},
    "policies": {},
    "brokers": {
      "brokerKeys": [],
      "brokerKeyNameMap": {}
    }
  }
}
```

`GET /api/v1/risk/alerts/overview` returns the alert digest used by `/risk-center` for alert table
refresh and aggregate summary counts:

```json
{
  "success": true,
  "data": {
    "meta": {
      "contractVersion": "risk-center-phase0-2026-04-09",
      "purpose": "risk_alerts_digest_for_risk_center",
      "generatedAt": "2026-04-09T10:00:00.000Z",
      "query": {
        "supported": ["limit", "offset", "status", "scope"],
        "resolved": {
          "limit": 10,
          "offset": 0,
          "status": null,
          "scope": null
        }
      },
      "sources": {
        "summary": "risk_alerts_aggregate",
        "alerts": "risk_alerts"
      }
    },
    "summary": {
      "total": 0,
      "bySeverity": {},
      "byStatus": {}
    },
    "alerts": {
      "items": [],
      "total": 0,
      "limit": 10,
      "offset": 0
    }
  }
}
```

Policy write request shape:

```json
{
  "scope": "broker",
  "brokerKey": "mudrex",
  "enabled": true,
  "monitorOnly": false,
  "enforceHardBlock": true,
  "marginUsageWarnPct": 70,
  "marginUsageCriticalPct": 85,
  "concentrationWarnPct": 30,
  "concentrationCriticalPct": 45,
  "dailyLossLimitPct": 5,
  "weeklyLossLimitPct": 12,
  "monthlyLossLimitPct": 20,
  "maxLeverage": 5,
  "maxOrderAllocation": 25,
  "maxTotalAllocation": 70,
  "maxAvgLeverage": 3
}
```

Expected client-visible write validation failures include:

- `400` `brokerKey is required for broker scope`
- numeric-range failures such as `marginUsageWarnPct must be <= 100`

## 8) Policy Semantics Decision
### Valid Policy Set
Phase 0 defines the valid target shape as:

- at most one `scope=user` policy per user
- at most one `scope=broker` policy per `(userId, brokerKey)`

If duplicates exist, the configuration is invalid and Phase 1 must make backend enforcement and
writes converge on this contract.

### Effective Policy Precedence
Phase 0 freezes the intended precedence as:

1. enabled broker-specific policy for the resolved broker
2. enabled user-default policy
3. no active policy

Disabled policies never win precedence.

### Policy Modes
Policy mode is derived from the stored booleans:

- disabled
  - `enabled=false`
  - ignored for enforcement
- monitor only
  - `enabled=true`
  - `monitorOnly=true`
  - never blocks
- warn
  - `enabled=true`
  - `monitorOnly=false`
  - `enforceHardBlock=false`
  - action is allowed, but the evaluation should surface warnings
- hard block
  - `enabled=true`
  - `monitorOnly=false`
  - `enforceHardBlock=true`
  - action should be rejected on implemented rule breach

### Threshold Coverage
Fields supported in the API/configuration contract:

- `marginUsageWarnPct`
- `marginUsageCriticalPct`
- `concentrationWarnPct`
- `concentrationCriticalPct`
- `dailyLossLimitPct`
- `weeklyLossLimitPct`
- `monthlyLossLimitPct`
- `maxLeverage`
- `maxOrderAllocation`
- `maxTotalAllocation`
- `maxAvgLeverage`

Phase 0 runtime guarantee:

- pre-trade evaluation currently only guarantees `maxLeverage` and `maxOrderAllocation`

Phase 0 explicitly does not claim full runtime enforcement yet for:

- margin usage thresholds
- concentration thresholds
- loss-window thresholds
- max total allocation
- max average leverage

## 9) Section Source Map
- `summary`
  - source type: `latest_snapshot`
  - source: `risk_snapshots`
  - current UI usage: rendered
- `controls`
  - source type: `snapshot_rows`
  - source: `risk_controls`
  - current UI usage: rendered
- `scenarios`
  - source type: `snapshot_rows`
  - source: `risk_scenarios`
  - current UI usage: rendered
- `alerts`
  - source type: `snapshot_rows`
  - source: `risk_alerts`
  - current UI usage: rendered
- `alerts summary`
  - source type: `aggregate_summary`
  - source: `risk_alerts` grouped counts
  - current UI usage: fetched but not currently rendered on the page
- `policies`
  - source type: `configuration`
  - source: `risk_policies`
  - current UI usage: rendered
- `policy versions`
  - source type: `audit_version_log`
  - source: `risk_policy_versions`
  - current UI usage: persisted on write, not rendered
- `brokers`
  - source type: `connected_accounts_plus_reference`
  - source:
    - connected broker accounts
    - active broker definitions
  - current UI usage: rendered
- `broker wallet/open-position values`
  - source type: `not_in_phase0_backend_contract`
  - current UI usage: page-level placeholders only

## 10) Deferred From Phase 0
- policy approval workflow
- rollback UI and rollback endpoint
- account-level policy scope
- true live broker KPI telemetry in `/risk/overview`
- real risk-capacity endpoint for `/risk-center`
- kill switch orchestration beyond activity logging
- recompute execution that recalculates snapshots and downstream rows

## 11) Current Known Gaps
- backend policy enforcement does not yet reliably follow the intended precedence contract
- duplicate-rule protection is currently strongest in the frontend, not the backend
- `/risk-center` uses overlapping overview + alerts-overview requests
- broker KPI wallet/open-position values are labeled as live in the UI, but are not in the current
  backend contract
- weekly/monthly risk-window usage is not currently backed by persisted values
- risk-window and broker-card statuses are partly derived in the page layer instead of coming from a
  canonical backend contract
- `POST /api/v1/risk/kill-switch` and `POST /api/v1/risk/recompute` are not Phase 0 trustworthy
  operator actions yet
- `/api/v1/risk/capacity` is deferred from the Risk Center Phase 0 baseline

These gaps remain visible on purpose so Phase 1 improves trust instead of polishing over ambiguity.

## 12) Phase 1 Starting Gates
Phase 1 should begin from this exact baseline:

- enforce duplicate prevention server-side and in DB where practical
- align runtime policy precedence with the contract above
- make loading/failure states truthful for the overview request path
- either wire real broker KPI values or relabel/remove the “live” claim
- either compute real weekly/monthly usage/status or surface them as unavailable
- expand integration coverage for policy-save effects and pre-trade risk enforcement

## 13) Phase 0 Deliverables In This Repo
- this document freezes the `/risk-center` ownership boundary, product purpose, and policy semantics
- `/risk/overview` now returns Phase 0 `meta` describing supported query inputs, section provenance,
  and capability flags
- `/risk/alerts/overview` now returns Phase 0 `meta` describing alert-summary query support and
  sources
- `npm run test:risk-center-contract` provides executable contract checks for:
  - policy-write validation baseline
  - risk overview contract metadata
  - risk alerts overview metadata
  - controller parameter forwarding
- the backend README and readiness tracker now point to this baseline for Phase 1 work

## 14) Phase 0 Exit Criteria
Phase 0 is complete when all of the following are true:

- the real frontend and backend owners are identified
- the page purpose and truth model are frozen in writing
- query/response contracts are frozen in writing
- policy precedence and mode semantics are explicit
- deferred capabilities are named instead of implied
- the backend exposes a self-describing contract baseline for the overview endpoints
- executable contract coverage exists in this repo

This repo now satisfies those Phase 0 criteria for `/risk-center`.
