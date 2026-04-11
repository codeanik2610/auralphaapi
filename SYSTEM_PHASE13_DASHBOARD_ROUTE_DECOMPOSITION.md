# System Phase 13 Dashboard Route Decomposition

Phase 13 continues the route-decomposition program after
`SYSTEM_PHASE12_DISCOVERY_WORKSPACES.md`.

The focus of this phase is `/overview`, which still carried a large amount of
route-local rendering and helper logic even after the command-center redesign in
Phase 3.

This phase moves Dashboard closer to a coordinator route so Phase 14 can start
from a cleaner baseline instead of another monolithic page body.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/dashboardPageHelpers.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/dashboardPageHelpers.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardNowWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardNowWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardMarketsWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardMarketsWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardBookWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardBookWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardAutomationWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardAutomationWorkspace.test.jsx`

## What Phase 13 Adds

### 1. Dashboard Tabs Are Now Real Route-Local Workspaces

The four command-center tab bodies now live in dedicated page-local modules:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardNowWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardMarketsWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardBookWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardAutomationWorkspace.jsx`

That means `DashboardPage` no longer renders the full workspace bodies inline
for:

- `Now`
- `Markets`
- `Book`
- `Automation`

The route now prepares the command-center state, URL state, and navigation
handlers, then hands those into focused workspace components.

### 2. Shared Dashboard Helper And Placeholder Logic Is Centralized

The previously inlined route-local helper logic now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/dashboardPageHelpers.jsx`

This module now owns the shared Dashboard-only rendering rules for:

- overview section timestamp copy
- section badge state
- severity and queue prioritization
- refresh summary copy
- latency formatting
- route-local placeholder shells
- overview section action chips

That keeps the Dashboard route from carrying a large footer block of render
helpers and placeholder components.

### 3. DashboardPage Is Materially Smaller

Phase 13 materially reduces the main Dashboard route size:

- pre-Phase-13 route size: `2654` lines
- post-Phase-13 route size: `1596` lines

That is a reduction of `1058` lines while keeping the Phase 3 command-center
contract intact.

The route still owns:

- fetch orchestration
- command-center tab state
- focus and pinned-symbol URL behavior
- summary-card preparation
- action handlers and workspace routing

But the heavy workspace rendering now lives in page-local modules.

### 4. Dashboard Now Has Focused Seam-Level Tests

Phase 13 adds targeted coverage for the new Dashboard seams:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/dashboardPageHelpers.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardNowWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardMarketsWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardBookWorkspace.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/DashboardAutomationWorkspace.test.jsx`

Together with the existing route-level suite, Dashboard now has:

- helper-level coverage
- workspace-level coverage for all four command-center tabs
- route-level operator-flow coverage for the integrated page

This gives the Dashboard refactor much better protection than a route-only test
shape.

## Intentional Phase 13 Boundaries

Phase 13 does not:

- redesign the command-center workflow from Phase 3
- extract Dashboard fetch coordination into dedicated controller hooks
- change the Overview API contracts or Redux slice semantics
- decompose the nested metric-preparation layer further
- begin the next large-route decomposition target yet

This phase is about reducing the Dashboard route into a clearer controller and
locking its new workspace seams with focused tests.

## Phase 14 Entry Criteria

Phase 14 can now start from a much cleaner Dashboard baseline:

- all four Dashboard tab bodies are extracted
- shared Dashboard render helpers are centralized
- the route is materially smaller and more coordinator-shaped
- each extracted Dashboard seam has focused tests

Current large-route scan after Phase 13:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`: `4980` lines
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.jsx`: `3840` lines
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLibrary/index.jsx`: `3731` lines
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.jsx`: `3132` lines
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.jsx`: `3116` lines

Recommended Phase 14 focus:

- move to `/schedulers` as the next large route decomposition target because it
  is now the largest remaining route by a wide margin
- keep the same playbook used in Discovery and Dashboard:
  extract route-local workspaces, centralize page-only helpers, and add focused
  seam-level tests
- keep Markets as the fallback next target if product priority favors
  day-to-day operator flow over route-size reduction

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Dashboard/index.jsx src/pages/Dashboard/index.test.jsx src/pages/Dashboard/dashboardPageHelpers.jsx src/pages/Dashboard/dashboardPageHelpers.test.js src/pages/Dashboard/DashboardNowWorkspace.jsx src/pages/Dashboard/DashboardNowWorkspace.test.jsx src/pages/Dashboard/DashboardMarketsWorkspace.jsx src/pages/Dashboard/DashboardMarketsWorkspace.test.jsx src/pages/Dashboard/DashboardBookWorkspace.jsx src/pages/Dashboard/DashboardBookWorkspace.test.jsx src/pages/Dashboard/DashboardAutomationWorkspace.jsx src/pages/Dashboard/DashboardAutomationWorkspace.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Dashboard/dashboardPageHelpers.test.js src/pages/Dashboard/DashboardNowWorkspace.test.jsx src/pages/Dashboard/DashboardMarketsWorkspace.test.jsx src/pages/Dashboard/DashboardBookWorkspace.test.jsx src/pages/Dashboard/DashboardAutomationWorkspace.test.jsx src/pages/Dashboard/index.test.jsx`

Observed test noise:

- the local zsh environment still prints the existing `/dev/fd/... compdef`
  shell-noise line before some commands. The verification commands still pass.
- the Dashboard route test still prints the existing React Router future-flag
  warnings in jsdom. The suite still passes.
