# System Phase 12 Discovery Workspaces

Phase 12 continues the Discovery decomposition work from
`SYSTEM_PHASE11_ROUTE_DECOMPOSITION.md`.

The focus of this phase is still `/discovery`, because the route still kept two
full workspace bodies inline after Phase 11:

- the Operate workspace for preferences and bot operations
- the Review workspace for suggestions, approvals, imports, and backtest
  handoffs

Phase 12 closes that gap so Phase 13 can move on from Discovery with a much
cleaner route-level controller.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryOperateWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryOperateWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryReviewWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryReviewWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryObserveWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryWorkspaceLead.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryRemoteSectionPagination.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/discoveryPageHelpers.js`

## What Phase 12 Adds

### 1. Operate Is Now A Real Route-Local Workspace

The full Operate cluster now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryOperateWorkspace.jsx`

This extracted component now owns the previously inlined Operate surface:

- Discovery preferences refresh and form rendering
- bot desk banner state
- create-bot draft workspace rendering
- edit-bot hydration and fallback copy
- bot list rendering and action wiring
- remote bot pagination

That means the route no longer needs to render the entire Discovery bot desk
inline.

### 2. Review Is Now A Real Route-Local Workspace

The full Review cluster now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryReviewWorkspace.jsx`

This extracted component now owns the previously inlined Review surface:

- latest Discovery handoff card
- template suggestions list
- suggestion detail panel
- strategy review queue
- strategy detail panel and backtest handoff actions
- review filter and remote pagination chrome

The route now prepares the Discovery review state and passes it into a focused
workspace component instead of keeping the whole approval desk inline.

### 3. DiscoveryPage Is Now Much Closer To A Coordinator

With Observe extracted in Phase 11 and Operate plus Review extracted in Phase
12, `DiscoveryPage` is now materially smaller:

- Phase 11 route size: `3513` lines
- Phase 12 route size: `3116` lines

The route still owns orchestration, deep-link state, fetch coordination, and
workspace banners, but the heavy workspace rendering has moved into dedicated
page-local modules.

### 4. Discovery Now Has Focused Workspace-Level Tests

Phase 12 adds targeted coverage for the newly extracted workspaces in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryOperateWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryReviewWorkspace.test.jsx`

Together with the Phase 11 tests, Discovery now has:

- helper-level coverage
- shared chrome coverage
- workspace-level coverage for Observe, Operate, and Review
- the existing route-level operator-flow suite

That gives the Discovery refactor much better protection than one monolithic
page test alone.

## Intentional Phase 12 Boundaries

Phase 12 does not:

- extract the Overview workspace into its own module
- move Discovery controller logic into dedicated hooks
- redesign the Discovery workflow or change its shell contract
- begin Dashboard decomposition yet
- touch Discovery backend contracts or websocket semantics

This phase is about finishing the biggest remaining Discovery workspace seams
before moving to the next large route.

## Phase 13 Entry Criteria

Phase 13 can now build on a much cleaner Discovery baseline:

- Discovery workspace bodies for Operate, Review, and Observe are extracted
- Discovery shared chrome and pure page rules already live in dedicated modules
- the route is smaller and more clearly controller-shaped
- each major extracted Discovery seam has focused tests

Recommended Phase 13 focus:

- move to `/dashboard` as the next large route decomposition target
- optionally extract Discovery Overview if we want Discovery to become almost
  entirely orchestration
- continue replacing route-level inline sections with page-local workspace
  modules and focused tests

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Discovery/index.jsx src/pages/Discovery/index.test.jsx src/pages/Discovery/discoveryPageHelpers.js src/pages/Discovery/discoveryPageHelpers.test.js src/pages/Discovery/DiscoveryWorkspaceLead.jsx src/pages/Discovery/DiscoveryWorkspaceLead.test.jsx src/pages/Discovery/DiscoveryRemoteSectionPagination.jsx src/pages/Discovery/DiscoveryRemoteSectionPagination.test.jsx src/pages/Discovery/DiscoveryObserveWorkspace.jsx src/pages/Discovery/DiscoveryObserveWorkspace.test.jsx src/pages/Discovery/DiscoveryOperateWorkspace.jsx src/pages/Discovery/DiscoveryOperateWorkspace.test.jsx src/pages/Discovery/DiscoveryReviewWorkspace.jsx src/pages/Discovery/DiscoveryReviewWorkspace.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Discovery/discoveryPageHelpers.test.js src/pages/Discovery/DiscoveryWorkspaceLead.test.jsx src/pages/Discovery/DiscoveryRemoteSectionPagination.test.jsx src/pages/Discovery/DiscoveryObserveWorkspace.test.jsx src/pages/Discovery/DiscoveryOperateWorkspace.test.jsx src/pages/Discovery/DiscoveryReviewWorkspace.test.jsx src/pages/Discovery/index.test.jsx`

Observed test noise:

- the local zsh environment still prints the existing `/dev/fd/... compdef`
  shell-noise line before some commands. The verification commands still pass.
