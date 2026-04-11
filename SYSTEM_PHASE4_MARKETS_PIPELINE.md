# System Phase 4 Markets Pipeline

Phase 4 turns `/markets` into the canonical market workspace instead of keeping
Markets, Watchlists, Signals, and Suggested Trades as four mostly separate desks.
The legacy routes still exist, but the system now has one clear route contract
for market-pipeline handoff.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/marketsPipeline.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/marketsPipeline.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Watchlists/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Signals/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/SuggestedTrades/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## What Phase 4 Adds

### 1. Canonical Market Pipeline Route

`/markets` is now the canonical route for the market pipeline.
It owns these workspace tabs:

- `scan`
- `review`
- `watchlists`
- `signals`
- `suggestions`

The route contract is now centralized in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/marketsPipeline.js`

Supported shared query context:

- `tab`
- `symbol`
- `interval`
- `watchlistId`
- `signalId`
- `tradeId`

Legacy `tab=setups` is normalized into `tab=signals` for compatibility.

### 2. Unified Pipeline Tabs Inside Markets

`/markets` no longer stops at screener + chart review.
It now includes:

- scanner and selected-market review
- watchlist coverage and tracked-symbol rotation
- signal queue and selected-signal posture
- suggested trade queue and selected trade plan
- saved pipeline views and quick jump presets

This keeps market context, queue context, and handoff context in one route.

### 3. Shared Handoff Contract From Legacy Pages

Legacy pages still work, but their “open markets” handoff now routes into the
correct pipeline tab instead of generic `/markets`.

Current canonical handoffs:

- `Watchlists -> /markets?tab=watchlists...`
- `Signals -> /markets?tab=signals...`
- `Suggested Trades -> /markets?tab=suggestions...`

This is the main Phase 4 freeze point for cross-page market navigation.

### 4. Saved Pipeline Views

The Markets workspace now stores local saved views in:

- `auralpha-markets:pipeline-views`

Saved views capture the current pipeline tab and focused context so operators
can return to the same market-review posture without rebuilding it manually.

## Intentional Phase 4 Boundaries

Phase 4 does not:

- delete the legacy Watchlists, Signals, or Suggested Trades pages
- merge backend data contracts into one API
- move execution actions directly into the market pipeline
- redesign Orders, Positions, Portfolio, or Risk Center

## Phase 5 Entry Criteria

Phase 5 can now merge the execution desk on top of a stable market handoff model:

- Signals and trade ideas can point into one canonical market route
- Watchlist context now survives market handoff cleanly
- Symbol / interval / queue-focus context is no longer ad hoc
- The market workspace owns the opportunity pipeline story

Recommended Phase 5 focus:

- unify Orders, Positions, Portfolio, and Risk Center
- preserve symbol/account/broker context across execution surfaces
- define one common execution activity trail

## Verification

Focused verification completed:

- `npx eslint src/helpers/marketsPipeline.js src/helpers/marketsPipeline.test.js src/pages/Markets/index.jsx src/pages/Markets/index.test.jsx src/pages/Watchlists/index.jsx src/pages/Watchlists/index.test.jsx src/pages/Signals/index.jsx src/pages/Signals/index.test.jsx src/pages/SuggestedTrades/index.jsx src/pages/SuggestedTrades/index.test.jsx`
- `./node_modules/.bin/vitest run src/helpers/marketsPipeline.test.js`

Known test-infra caveat:

- The existing page-level UI tests for Markets and the legacy market-adjacent pages
  do not terminate cleanly in the current Vitest/jsdom harness because of pre-existing
  page/test-environment timing behavior. Phase 4 route helper coverage is green, and
  the page code is lint-clean, but those page harnesses should be stabilized separately.
