# System Phase 9 Workspace Skeleton

Phase 9 freezes the shared page-surface contract across the major workspace
families.

This phase does not invent another information architecture. It standardizes
how the existing workspace routes present themselves so the shell now reads as
one system instead of a collection of unrelated long-form pages.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/WorkspaceSurfacePage.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/WorkspaceSurfacePage.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Backtests/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Activity/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokersData/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokerDefinitions/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## What Phase 9 Adds

### 1. Shared Page-Surface Contract

The canonical page wrapper now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/WorkspaceSurfacePage.jsx`

That wrapper freezes the high-level page grammar as:

- header
- ordered chrome bands
- content surface

Each route can still decide which bands it needs, but the shell now has one
shared structure for:

- page headers
- summary and focus strips
- trust or status banners
- workspace tabs and rails
- core content panels

This is the Phase 9 freeze point for cross-page structure.

### 2. Shared Navigation Shell Styling

Shared shell styling now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

Phase 9 adds one visual grammar for the cross-page chrome:

- `workspace-surface-page`
- `workspace-surface-header`
- `workspace-surface-bands`
- `workspace-surface-band`
- `workspace-surface-content`
- `workspace-surface-navigation-shell`

This makes workspace tabs, rails, and trust/status strips read consistently
across the system instead of each page inventing its own shell.

### 3. Representative Adoption Across Every Major Workspace Family

The shared skeleton is now active on representative top-level routes across the
system:

- Command: `/overview`
- Markets: `/markets`
- Execution: `/portfolio`
- Strategy: `/backtests`, `/discovery`
- Operations: `/activity`, `/automations`
- Integrations: `/brokers-data`, `/broker-definitions`

Those pages keep their existing domain logic, but they now render through the
same page-surface grammar:

- route header first
- summary / context / trust bands second
- workspace navigation shell next
- primary working surface last

### 4. Workspace Rails and Tabs Now Sit Inside One Consistent Chrome Model

Phase 9 does not replace the workspace-specific rails added in earlier phases.
Instead, it makes them behave like one family:

- the execution rail on `/portfolio`
- the strategy rail on `/backtests` and `/discovery`
- the operations rail on `/activity` and `/automations`
- the integrations rail on `/brokers-data` and `/broker-definitions`

Their local behavior stays domain-specific, but their placement and visual
weight are now consistent.

### 5. Page Logic Stays Local While Shell Grammar Is Shared

Phase 9 intentionally avoids a dangerous refactor where page business logic is
pulled into one giant shared abstraction.

The wrapper owns only layout grammar. The pages still own:

- route-specific data loading
- tab models
- drawers and selected detail state
- page actions
- domain-specific status messaging

That keeps the shell standardized without making the system brittle.

## Intentional Phase 9 Boundaries

Phase 9 does not:

- merge the workspace routes together
- replace page-specific summary cards with one generic summary component
- unify every list/detail panel into one shared component
- rewrite the market pipeline page logic
- redesign the sidebar, topbar, or workspace rails again
- remove all long-form pages from the system in one pass

This phase is about freezing shell grammar first.

## Phase 10 Entry Criteria

Phase 10 can now build on a stable cross-page skeleton:

- major workspace families share the same page-surface contract
- headers, chrome bands, navigation shells, and primary content now follow the
  same order
- workspace rails and workspace tabs now read as one system pattern
- page-specific business logic remains local instead of being collapsed into a
  risky shared abstraction

Recommended Phase 10 focus:

- simplify overgrown pages and break up giant route files
- prune duplicate or low-value bands now that the shell is standardized
- harden test harnesses and clean up persistent page-test caveats
- improve role defaults, saved views, and performance of the heaviest pages

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/components/common/WorkspaceSurfacePage.jsx src/components/common/WorkspaceSurfacePage.test.jsx src/pages/Dashboard/index.jsx src/pages/Markets/index.jsx src/pages/Portfolio/index.jsx src/pages/Backtests/index.jsx src/pages/Discovery/index.jsx src/pages/Activity/index.jsx src/pages/Automations/index.jsx src/pages/BrokersData/index.jsx src/pages/BrokerDefinitions/index.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/components/common/WorkspaceSurfacePage.test.jsx src/pages/Dashboard/index.test.jsx src/pages/Activity/index.test.jsx src/pages/Automations/index.test.jsx src/pages/BrokersData/index.test.jsx src/pages/BrokerDefinitions/index.test.jsx src/pages/Backtests/index.test.jsx src/pages/Discovery/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Portfolio/index.test.jsx`

Observed test noise and caveats:

- React Router v7 future-flag warnings still appear in the existing
  Vitest/jsdom harness on some page tests. They are pre-existing harness
  warnings, not new Phase 9 failures.
- `/markets` still has the previously known page-test harness problem where the
  isolated Vitest run renders the expected cases but does not terminate
  cleanly. Phase 9 does not hide that caveat; Phase 10 should either harden or
  replace that harness.
