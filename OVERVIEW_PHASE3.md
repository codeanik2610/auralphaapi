# Overview Phase 3

Date: 2026-04-09

## 1) Goal
Phase 3 for `/overview` hardens the backend aggregation path so the page can survive partial
dependency failure instead of collapsing into an all-or-nothing request.

The core objectives were:

- stop treating overview assembly like a single brittle fan-out
- keep the API usable when one or more sections degrade
- add section-level request status so the frontend can tell healthy emptiness from degraded data
- bound live reference lookups with explicit timeouts

## 2) What Changed
### Backend resilience contract
The overview contract in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Overview.ts`
now exposes resilience metadata:

- `meta.resilience.status`
- `meta.resilience.degradedSections`
- `meta.resilience.timeoutSections`
- `meta.resilience.routingFallback`
- `meta.resilience.summary`

Each section inside `meta.sections` now also carries request-level runtime metadata:

- `requestStatus`
- `fetchMode`
- `statusDetail`
- `timeoutMs`

This means the frontend can distinguish:

- healthy primary data
- degraded fallback data
- skipped sections
- missing sections with no usable result

### Aggregation behavior
The overview aggregator in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OverviewService.ts`
was reworked from a brittle `Promise.all` request fan-out into guarded section loaders.

Phase 3 backend changes:

- primary section calls now degrade independently instead of failing the whole response
- live Mudrex market/reference calls now run with bounded timeouts
- wallet/futures data can fall back to `funds_snapshots`
- portfolio summary/holdings can fall back to the latest `portfolio_snapshots` row
- request health now resolves to `degraded` when the overview was assembled with partial data
- routing now records whether the request used a normal route resolution or a default mudrex
  fallback route

### Frontend handling
The `/overview` page in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.jsx`
now surfaces the new backend resilience contract instead of ignoring it.

Phase 3 frontend changes:

- degraded overview responses now show a request-level warning banner
- section headers can show `Timed out`, `Degraded`, or `Fallback` alongside the existing
  provenance badges
- the page still keeps the Phase 2 focus workflow, but now it can explain why a section is partial

## 3) Phase 3 Outcome
`/overview` is now resilient enough to serve as a partial-response dashboard instead of a fragile
aggregator.

If one section degrades:

- the overview request still returns successfully
- unaffected sections continue rendering
- degraded sections are explicitly marked in the contract and in the UI

This sets up Phase 4 cleanly, where the next layer is operational credibility:

- stale snapshot detection
- richer diagnostics
- per-section warning quality
- observability and latency tracking

## 4) Known Carry-Forward For Phase 4
- stale snapshot age is still not classified as healthy vs stale vs critical
- automation diagnostics are still shallow compared with what `AutomationsService` already knows
- request-level warning copy is present, but section-level freshness messaging is still basic
- overview latency is not yet emitted as dedicated overview observability

## 5) Verification
Phase 3 verification passed with:

- `npm run test:overview-contract`
- `npm run test:overview-resilience`
- `npx eslint src/api/contracts/Overview.ts src/api/services/OverviewService.ts scripts/test-overview-contract.ts scripts/test-overview-resilience.ts`
- `npm run test:ui -- src/pages/Dashboard/index.test.jsx`
- `npx eslint src/pages/Dashboard/index.jsx src/pages/Dashboard/index.test.jsx src/components/dashboard/OverviewHero.jsx src/helpers/overviewFocus.js`
- `npm run type-check`
