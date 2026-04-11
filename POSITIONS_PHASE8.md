# Positions Phase 8

Date: 2026-04-09

## 1) Goal
Phase 8 closes the last two `/positions` readiness items:

- action auditability for route-safe mutations
- shareable workspace state through the URL

By the end of this phase the positions desk should:

- log enough context to explain margin, protection, reverse, close, and partial-close actions after the fact
- restore the operator workspace from a copied URL
- ship with the same release-gate and signoff pattern used by the other critical operator surfaces

## 2) What Changed
### Backend mutation audit trail
The position mutation path in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerPositionsFacadeService.ts`
now runs through one audit wrapper for:

- add margin
- create protection orders
- update protection orders
- reverse
- partial close
- full close

Each mutation now logs:

- actor user id
- position id
- broker/account route target
- symbol when a snapshot is available
- request intent details
- result details or broker failure details

Those details are persisted through activity flags, reference ids, and route correlation so the lifecycle drawer can explain what happened without relying on raw broker logs.

The lifecycle contract in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Positions.ts`
now exposes richer activity metadata, and the lifecycle mapper returns that data through
`recentActivity`.

### Shareable positions workspace state
The Positions page in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.jsx`
now persists its workspace state in the URL:

- live desk vs history archive tab
- broker filter
- account filter
- search text
- history date window
- selected position
- open detail drawer target
- active detail tab

The page also adds lightweight broker, account, and search filters so the shared URL represents a real operator workspace instead of only the raw table selection.

### Final operational tooling
Positions now has a final signoff script in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-positions.ts`

and the release gate in
`/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-positions.ts`
now includes the Phase 8 backend assertions.

The package scripts are:

- `npm run test:positions-phase8`
- `npm run release-gate:positions`
- `npm run signoff:positions`

## 3) Phase 8 Outcome
`/positions` now behaves like a shareable operator desk instead of a volatile local page state.

An operator can copy a URL and reopen:

- the same tab
- the same filters
- the same selected position
- the same detail drawer context

At the same time, every critical mutation now leaves behind a lifecycle-visible audit trail with route, request, and result context.

## 4) What Remains
No new `/positions` follow-up is being carried in the readiness tracker after Phase 8.

The remaining work for positions is broader release governance:

- run the live health check in a real environment with `POSITIONS_RUN_LIVE_CHECKS=true`
- complete final signoff evidence with `npm run signoff:positions`

## 5) Verification
Phase 8 verification passed with:

- `npm run test:positions-phase8`
- `npx eslint src/api/contracts/Positions.ts src/api/services/BrokerPositionsFacadeService.ts scripts/test-positions-phase8.ts scripts/release-gate-positions.ts scripts/signoff-positions.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/store/slices/positionsSlice.test.js src/pages/Positions/index.test.jsx src/pages/Positions/trust.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/positionsSlice.js src/store/slices/positionsSlice.test.js src/pages/Positions/index.jsx src/pages/Positions/index.test.jsx src/pages/Positions/trust.js src/pages/Positions/trust.test.js`
- `npm run release-gate:positions`
