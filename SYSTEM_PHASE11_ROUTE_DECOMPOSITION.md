# System Phase 11 Route Decomposition

Phase 11 continues the post-shell simplification work from
`SYSTEM_PHASE10_SIMPLIFICATION_HARDENING.md`.

The focus of this phase is `/discovery`, because it remained one of the
heaviest route files in the app shell and still mixed:

- page-level controller logic
- pure page-local helpers
- repeated workspace chrome
- the full Observe workspace implementation

Phase 11 closes that gap so Phase 12 can continue decomposition from a cleaner
and more testable Discovery baseline.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/discoveryPageHelpers.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/discoveryPageHelpers.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryWorkspaceLead.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryWorkspaceLead.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryRemoteSectionPagination.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryRemoteSectionPagination.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryObserveWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryObserveWorkspace.test.jsx`

## What Phase 11 Adds

### 1. Discovery Page Rules Are No Longer Buried Inline

The new page-local helper module now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/discoveryPageHelpers.js`

It now owns the pure page rules that were previously embedded near the top of
`/discovery`:

- scheduler and page-size constants
- workspace normalization
- activity and scheduler deep-link builders
- dependency status summarization
- workspace capability posture
- stale versus unavailable banner logic
- discovery status and scope formatting helpers
- scheduler progress normalization

That makes the route easier to reason about and lets the brittle page logic be
tested without rendering the full Discovery workspace.

### 2. Repeated Discovery Chrome Is Now Reusable

The repeated workspace lead block is now extracted into:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryWorkspaceLead.jsx`

The remote list footer is now extracted into:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryRemoteSectionPagination.jsx`

That means `DiscoveryPage` no longer has to inline the same workspace chrome
and remote-pagination markup across Overview, Operate, Review, and Observe.

### 3. Observe Is Now a Real Route-Local Workspace Component

The full Observe cluster now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryObserveWorkspace.jsx`

This extracted component now owns the previously inlined Observe workspace
surface:

- workspace lead and live-feed posture chips
- linked scheduler run audit section
- linked scheduler update rows
- persisted plus live discovery feed view
- recent runs table and selected-run detail

The page route now acts more like a controller that prepares Discovery state and
hands it into route-local sections, instead of rendering every workspace inline.

### 4. The Discovery Page Test Can Stay Focused On Operator Flows

Phase 11 keeps the existing route-level flow coverage in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.test.jsx`

and adds focused unit coverage for the new page-local seams in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/discoveryPageHelpers.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryWorkspaceLead.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryRemoteSectionPagination.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/DiscoveryObserveWorkspace.test.jsx`

That keeps the route test focused on end-to-end Discovery behavior while the
new smaller tests prove the extracted logic directly.

## Intentional Phase 11 Boundaries

Phase 11 does not:

- fully decompose `/discovery` into many small route-local sections
- extract the Operate or Review workspace bodies yet
- redesign Discovery workflows or change the Phase 9 shell contract
- modify Discovery backend contracts or websocket behavior
- begin the next large-route cleanup for `/dashboard`

This phase is about turning the biggest Discovery seams into stable modules
without disturbing the user-facing workflow.

## Phase 12 Entry Criteria

Phase 12 can now build on a cleaner Discovery baseline:

- the top-of-file Discovery helper rules now live in a dedicated module
- repeated workspace lead and remote pagination chrome are extracted
- the Observe workspace is a real route-local component
- Discovery now has smaller focused tests in addition to the page-level flow
  suite

Recommended Phase 12 focus:

- continue decomposing `/discovery`, especially the Operate and Review
  workspaces
- extract more route-local controllers or section components from other large
  routes, with `/dashboard` as the next strong candidate
- prune any remaining redundant focus or summary bands now that Discovery is
  easier to reason about
- keep replacing monolithic route assertions with smaller operator-flow and
  page-local tests

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Discovery/index.jsx src/pages/Discovery/index.test.jsx src/pages/Discovery/discoveryPageHelpers.js src/pages/Discovery/discoveryPageHelpers.test.js src/pages/Discovery/DiscoveryRemoteSectionPagination.jsx src/pages/Discovery/DiscoveryRemoteSectionPagination.test.jsx src/pages/Discovery/DiscoveryWorkspaceLead.jsx src/pages/Discovery/DiscoveryWorkspaceLead.test.jsx src/pages/Discovery/DiscoveryObserveWorkspace.jsx src/pages/Discovery/DiscoveryObserveWorkspace.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Discovery/discoveryPageHelpers.test.js src/pages/Discovery/DiscoveryRemoteSectionPagination.test.jsx src/pages/Discovery/DiscoveryWorkspaceLead.test.jsx src/pages/Discovery/DiscoveryObserveWorkspace.test.jsx src/pages/Discovery/index.test.jsx`

Observed test noise:

- the local zsh environment still prints the existing `/dev/fd/... compdef`
  shell-noise line before some commands. The verification commands still pass.
