# System Phase 10 Simplification And Hardening

Phase 10 simplifies and hardens the heaviest post-shell workspace route instead
of inventing another navigation layer.

The focus of this phase is `/markets`, because it remained:

- the largest top-level route file in the app shell
- the only representative workspace page with a known non-terminating page test
- the page where saved views, URL state, and local symbol review logic were
  still tightly coupled in one file

Phase 10 closes that gap so Phase 11 can continue route decomposition from a
cleaner and more stable baseline.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/marketsPageHelpers.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/marketsPageHelpers.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/MarketsPipelineViewsPanel.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/MarketsPipelineViewsPanel.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/marketsPipeline.test.js`

## What Phase 10 Adds

### 1. Markets Page State Rules Are No Longer Buried Inline

The new page-local helper module now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/marketsPageHelpers.js`

It now owns the page-specific logic that was previously embedded near the top of
`/markets`:

- query default resolution
- page-size and filter normalization
- provenance tone and freshness formatting
- active pipeline context building
- saved-view creation and merge rules
- pipeline preset view generation

This reduces the top-level `MarketsPage` file and makes the most brittle page
logic directly testable without rendering the whole workspace.

### 2. The Pipeline View Strip Is Now a Real Component

The saved-view and quick-jump strip is now extracted into:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/MarketsPipelineViewsPanel.jsx`

That separates shell-adjacent presentation from the route controller logic.

The page no longer needs to inline:

- quick-jump rendering
- saved-view rendering
- saved-view empty-state copy
- button wiring for save / open / remove interactions

This is the first Phase 10 decomposition pattern for large post-shell routes:
page state stays in the route, but repeated chrome-like workspace sections move
into page-local components.

### 3. Saved Views Now Follow One Canonical Merge Rule

Saved view handling is now hardened through the helper module instead of ad hoc
inline array logic.

Phase 10 now guarantees that saved pipeline views:

- reuse the current canonical query string when it already exists
- fall back to the canonical pipeline context when the URL is sparse
- replace older entries with the same search posture instead of duplicating them
- keep the most recent views first
- stay bounded by the saved-view limit

That closes the “saved view logic spread across the route body” problem from
Phase 9.

### 4. The Markets Signal Selection Loop Is Fixed

Phase 10 closes the real state-loop bug that was keeping the isolated Markets
page test from terminating cleanly.

The bug was in `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.jsx`:

- the global signals queue wanted to auto-select the first signal
- the selected-symbol review stack wanted to clear the same `activeSignalId`
  whenever no symbol-specific signal candidates existed
- when no symbol was pinned, those two effects fought each other and caused a
  render loop

The page now only aligns the selected-market signal stack when a symbol is
actually pinned and symbol-specific signal candidates exist.

This is both a UI hardening fix and a test-harness fix. The isolated Markets
page test now exits normally.

### 5. The Markets Harness Is Replaced With Smaller, Truer Tests

Phase 10 keeps one page-level Markets smoke test in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.test.jsx`

and moves richer logic checks into:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/marketsPageHelpers.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/MarketsPipelineViewsPanel.test.jsx`

That means the route test is no longer responsible for proving every piece of
saved-view logic and presentation detail by itself.

The route-level test now focuses on:

- workspace hydration
- canonical query handoff
- legacy desk navigation
- saved-view state integration

The helper and panel tests now cover the smaller units directly.

## Intentional Phase 10 Boundaries

Phase 10 does not:

- fully decompose `/markets` into many route-local sections
- finish the same decomposition work for `/discovery`, `/dashboard`, or
  `/broker-definitions`
- redesign the Markets workflow or change the shell contract from Phase 9
- add server-backed saved views for Markets
- change the market data API contracts

This phase is about closing the biggest route-level hardening gap first.

## Phase 11 Entry Criteria

Phase 11 can now build on a cleaner post-shell baseline:

- the heaviest remaining shell route has begun route-local decomposition
- the Markets saved-view logic now has dedicated tests
- the Markets page no longer contains the signal-selection render loop
- the last known Phase 9 page-test caveat is closed

Recommended Phase 11 focus:

- continue breaking up the largest remaining route files, especially
  `/discovery`, `/dashboard`, and the remaining large Markets sections
- extract more route-local sections and controllers from giant pages without
  disturbing the Phase 9 shell contract
- prune redundant focus and summary bands now that large pages are easier to
  reason about
- harden more representative page suites around real operator flows instead of
  monolithic route tests

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Markets/index.jsx src/pages/Markets/index.test.jsx src/pages/Markets/marketsPageHelpers.js src/pages/Markets/marketsPageHelpers.test.js src/pages/Markets/MarketsPipelineViewsPanel.jsx src/pages/Markets/MarketsPipelineViewsPanel.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Markets/marketsPageHelpers.test.js src/pages/Markets/MarketsPipelineViewsPanel.test.jsx src/helpers/marketsPipeline.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Markets/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/components/common/WorkspaceSurfacePage.test.jsx src/pages/Dashboard/index.test.jsx src/pages/Portfolio/index.test.jsx src/pages/Markets/index.test.jsx src/pages/Markets/marketsPageHelpers.test.js src/pages/Markets/MarketsPipelineViewsPanel.test.jsx src/helpers/marketsPipeline.test.js`

Observed test noise:

- React Router v7 future-flag warnings still appear in the existing
  Vitest/jsdom harness on some representative page tests such as Dashboard and
  Portfolio. They are pre-existing harness warnings, not new Phase 10 failures.
