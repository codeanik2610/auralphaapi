# Overview Phase 0

Date: 2026-04-09

## 1) Problem Statement
AurAlpha already has a real protected `/overview` route, but the current page mixes live reference
data, DB snapshots, and backend-computed summaries without making that contract explicit.
Phase 0 exists to freeze what `/overview` is for, which query inputs are real, which payload fields
the current UI actually uses, and where every section comes from before Phase 1 starts changing
trust semantics and UX.

## 2) Ownership Boundary
Frontend ownership lives in `/Users/apple/Documents/Project/Frontend/aurAlphaApp`:

- route registration: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`
- page UI: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.jsx`
- hero UI: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/dashboard/OverviewHero.jsx`
- overview state: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/overviewSlice.js`
- API call wiring: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`

Backend ownership lives in this repo:

- controller: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/OverviewController.ts`
- service: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OverviewService.ts`
- contract: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Overview.ts`
- funds snapshots: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerWalletFacadeService.ts`
- live reference data: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerReferenceDataService.ts`
- automations/alerts/signals/portfolio summaries:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AutomationsService.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AlertsService.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/SignalsService.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioService.ts`

Phase 1 may change copy, layout, labels, and interaction behavior, but it should preserve the
contract decisions below unless frontend and backend are updated together.

## 3) Product Decision
`/overview` is an operator command center, not a system-of-record page and not a fully live
portfolio terminal.

That means:

- the page is allowed to mix live external reference data with DB-backed operational summaries
- the page is allowed to show limited digests instead of full module payloads
- the page must explicitly distinguish live data from snapshots and computed summaries in later
  phases
- users should be able to navigate from `/overview` into source-of-truth pages such as
  `/markets`, `/alerts`, `/signals`, `/automations`, and `/portfolio`

## 4) Current End-To-End Data Flow
1. An authenticated user lands on `/overview`.
2. The frontend mounts `DashboardPage` and dispatches `fetchOverview({ config, selectedSymbol })`.
3. The frontend calls `GET /api/v1/overview` through `tradingApi.getOverview`.
4. The backend resolves the operator account route from connected broker accounts:
   - default connected account first
   - otherwise the first connected account
   - otherwise broker fallback `mudrex`
5. The backend fan-outs to:
   - funds snapshots for wallet and futures balances
   - Mudrex futures assets list
   - automation digest + summary
   - alert digest + summary
   - signal digest + summary
   - portfolio summary + holdings digest
6. If `selectedSymbol` is present, the backend resolves selected asset detail and leverage for that
   symbol.
7. If `selectedSymbol` is absent, the backend resolves selected asset detail from the first returned
   market row.
8. The frontend renders hero, KPI, market, selected-asset, exposure, automation, alert, and signal
   sections from one Redux slice.

## 5) Frozen Query Contract
Phase 0 freezes `/api/v1/overview` to these supported query params:

- `selectedSymbol`
- `sort`
- `order`

Phase 0 explicitly does not support these overview query params:

- `brokerKey`
- `accountId`
- `limit`

Decisions:

- account routing is backend-resolved for `/overview`; callers do not choose broker/account here
- section limits are fixed in the backend for Phase 0:
  - assets: `8`
  - automations: `5`
  - alerts: `5`
  - signals: `3`
  - portfolio holdings: `5`

## 6) Frozen Response Contract
`GET /api/v1/overview` returns the existing data fields plus a Phase 0 `meta` block that explains
purpose, query support, route resolution, selected-symbol resolution, and section provenance.

Response shape:

```json
{
  "success": true,
  "data": {
    "meta": {
      "contractVersion": "overview-phase0-2026-04-09",
      "purpose": "operator_command_center",
      "generatedAt": "2026-04-09T10:00:00.000Z",
      "query": {
        "supported": ["selectedSymbol", "sort", "order"],
        "ignored": ["brokerKey", "accountId", "limit"],
        "sectionLimits": {
          "assets": 8,
          "automations": 5,
          "alerts": 5,
          "signals": 3,
          "portfolioHoldings": 5
        }
      },
      "routing": {
        "accountSelection": "default_connected_account_or_first_connected_account",
        "brokerKey": "mudrex",
        "accountId": "acct-default",
        "referenceBrokerKey": "mudrex"
      },
      "selection": {
        "requestedSymbol": "BTCUSDT",
        "resolvedSymbol": "BTCUSDT",
        "mode": "requested"
      }
    },
    "health": {
      "status": "ok",
      "timestamp": "2026-04-09T10:00:00.000Z",
      "scope": "overview_request",
      "summary": "Overview payload assembled successfully. This is not a platform-wide health signal."
    },
    "walletFunds": {},
    "futuresFunds": {},
    "assets": [],
    "selectedAsset": null,
    "leverage": null,
    "automations": {},
    "automationsSummary": {},
    "alerts": {},
    "alertsSummary": {},
    "signals": {},
    "signalsSummary": {},
    "portfolioSummary": {},
    "portfolioHoldings": {}
  }
}
```

## 7) Section Source Map
Each field is frozen as one of `live_external`, `db_snapshot`, or `computed_summary`.

- `health`
  - source type: `computed_summary`
  - current UI usage: rendered
  - note: this is only an overview assembly heartbeat today, not a full health signal
- `walletFunds`
  - source type: `db_snapshot`
  - source: `funds_snapshots.wallet_funds_json`
  - current UI usage: rendered
- `futuresFunds`
  - source type: `db_snapshot`
  - source: `funds_snapshots.futures_funds_json`
  - current UI usage: rendered
- `assets`
  - source type: `live_external`
  - source: Mudrex futures reference feed
  - current UI usage: rendered
- `selectedAsset`
  - source type: `live_external`
  - source: Mudrex selected-symbol detail
  - current UI usage: rendered
- `leverage`
  - source type: `live_external`
  - source: Mudrex leverage lookup
  - current UI usage: rendered
- `automations`
  - source type: `computed_summary`
  - source: automation operator digest from DB-backed services
  - current UI usage: rendered
- `automationsSummary`
  - source type: `computed_summary`
  - current UI usage: rendered
- `alerts`
  - source type: `computed_summary`
  - current UI usage: rendered
- `alertsSummary`
  - source type: `computed_summary`
  - current UI usage: rendered
- `signals`
  - source type: `computed_summary`
  - current UI usage: rendered
- `signalsSummary`
  - source type: `computed_summary`
  - current UI usage: available but not rendered
- `portfolioSummary`
  - source type: `computed_summary`
  - current UI usage: available but not rendered
- `portfolioHoldings`
  - source type: `db_snapshot`
  - current UI usage: rendered

## 8) Phase 0 Decisions
### Preserved But Currently Unused Fields
Phase 0 keeps these fields in the API even though the current `/overview` page does not render
them:

- `signalsSummary`
- `portfolioSummary`

Reason:

- they are already part of the backend contract
- they are likely candidates for Phase 1 KPI truthfulness fixes
- removing them now would create churn without improving trust

### Selected Symbol Resolution
Decision:

- `selectedSymbol` is a real supported overview input
- if absent, the backend falls back to the first returned asset symbol
- if no assets are returned, the selected-asset detail remains empty

### Scope Guardrails For Phase 1
In scope:

- truthful labels and provenance
- KPI semantics
- section timestamps and stale-state copy
- better selected-market interaction
- hierarchy/layout improvements

Out of scope:

- deep backend resilience refactors
- partial-failure fan-out redesign
- live polling strategy changes
- cache architecture changes

## 9) Current Known Gaps
- the hero still labels `health.status` as "System health" even though the payload only exposes an
  overview assembly heartbeat
- the frontend still derives "Daily PnL" from wallet totals instead of using `portfolioSummary.dayPnL`
- the current page still mixes snapshot-backed and live-backed sections without explicit timestamps
- the selected asset is only user-driven if the caller passes `selectedSymbol`
- the page still renders a watchlist action banner that does not belong to the overview contract
- one failed backend dependency can still fail the entire page because the service uses a single
  `Promise.all`

These remain visible on purpose so Phase 1 improves trust rather than hiding ambiguity.

## 10) Verification
Phase 0-specific verification passed with:

- `npm run test:overview-contract`
- `npx eslint src/api/contracts/Overview.ts src/api/controllers/OverviewController.ts src/api/services/OverviewService.ts scripts/test-overview-contract.ts`

Current repo-wide blocker unrelated to `/overview`:

- `npm run type-check` currently fails because
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-services.ts` still imports a
  removed `DiscoverySchedulerService` and removed scheduler validator exports that no longer exist
  in `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/scheduler.validator.ts`
