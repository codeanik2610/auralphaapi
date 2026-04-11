# System Phase 7 Operations Workspace

Phase 7 freezes the operations-workspace contract across:

- `/alerts`
- `/activity`
- `/automations`
- `/schedulers`
- `/email-deliveries`

The system no longer treats those pages as unrelated monitoring tools. They now
share one cross-page incident thread model for queue triage, audit review,
automation recovery, scheduler follow-up, and delivery troubleshooting.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/operationsWorkspace.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/operationsWorkspace.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/OperationsWorkspaceRail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Alerts/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Alerts/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Activity/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Activity/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/useAutomationsPageController.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/useAutomationsDetailController.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/useAutomationsCreateDrawerController.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/EmailDeliveries/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/EmailDeliveries/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## What Phase 7 Adds

### 1. Shared Operations Incident Contract

The canonical ops handoff now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/operationsWorkspace.js`

Supported shared ops context:

- `route`
- `referenceId`
- `related`

Those keys now persist when operators move between:

- alert triage
- activity audit review
- automation recovery
- scheduler investigation
- email delivery incidents

The helper also freezes:

- operations-workspace tab metadata
- canonical cross-page path building
- shared context chips used in the rail
- clear-path behavior that strips only shared ops context and keeps page-local
  filters or drawers intact

### 2. Shared Operations Rail

Each operations surface now renders the same rail via:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/OperationsWorkspaceRail.jsx`

That rail adds:

- a common operations handoff banner
- preserved route / reference / related chips
- cross-page operations tabs
- a page-local clear action that removes the shared incident thread without
  blindly dropping the current local workspace state

This is the Phase 7 freeze point for operations navigation and incident
continuity.

### 3. Alerts Now Hand Off Into the Ops Workspace

- `/alerts` now derives shared incident context from the selected alert when the
  URL does not already carry one
- alert activity links now use the shared operations path builder
- automations handoff links opened from alerts now preserve incident context
- the alerts page keeps its own inbox filters and drawer state while the shared
  ops rail rides above that local workflow

### 4. Activity Is the Shared Audit Surface

- `/activity` now renders the common operations rail above the local
  `Stream / Exports` workspace tabs
- shared incident context survives while export history, filters, and saved
  views stay page-local
- clearing the shared incident thread leaves local activity filters intact

### 5. Automations No Longer Drop Shared Incident Context

- `/automations` now renders the common operations rail above the fleet desk
- selecting an automation preserves the active operations incident thread
- creating a new automation preserves the shared incident thread instead of
  redirecting to a bare `?selected=` URL
- automations now establish a fallback ops thread from the selected automation
  when no upstream shared context exists

### 6. Schedulers and Email Deliveries Now Participate in the Same Model

- `/schedulers` now derives a shared ops thread from the selected scheduler or
  run and exposes the common operations rail
- `/email-deliveries` now derives a shared ops thread from the selected delivery
  and exposes the same rail for admin users
- both pages preserve local search params such as selected run, queue tab, or
  detail drawer state while the shared incident contract remains visible

## Intentional Phase 7 Boundaries

Phase 7 does not:

- merge all operations tools into one route
- replace each page’s local queue, drawer, or filter model
- create one shared backend API for alerts, activity, automations, schedulers,
  and email
- redesign all page-specific operational controls
- add a new global inbox data source beyond the shell launcher from Phase 2

This phase is about shared incident continuity first, not collapsing all ops
work into one page.

## Phase 8 Entry Criteria

Phase 8 can now build on a stable operations workspace:

- shared `route / referenceId / related` context survives handoff across all
  five operations surfaces
- the operations rail is consistent across alerts, activity, automations,
  schedulers, and email deliveries
- automations selection and creation no longer discard the shared incident
  thread
- alerts activity links and automations links now use the shared ops path model
- clearing shared ops context preserves page-local state instead of resetting
  the entire page

Recommended Phase 8 focus:

- unify the integrations workspace
- consolidate broker routes, accounts, definitions, and diagnostics
- apply the same shared-workspace-contract pattern used in Phases 5, 6, and 7

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/eslint src/helpers/operationsWorkspace.js src/helpers/operationsWorkspace.test.js src/components/common/OperationsWorkspaceRail.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/eslint src/pages/Alerts/index.jsx src/pages/Alerts/index.test.jsx src/pages/Activity/index.jsx src/pages/Activity/index.test.jsx src/pages/Automations/index.jsx src/pages/Automations/useAutomationsPageController.js src/pages/Automations/useAutomationsDetailController.js src/pages/Automations/useAutomationsCreateDrawerController.js src/pages/Automations/index.test.jsx src/pages/Schedulers/index.jsx src/pages/EmailDeliveries/index.jsx src/pages/EmailDeliveries/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/helpers/operationsWorkspace.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Alerts/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Activity/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Automations/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Schedulers/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/EmailDeliveries/index.test.jsx`

Observed test noise:

- React Router v7 future-flag warnings still appear in the existing
  Vitest/jsdom setup on some page tests. They are pre-existing harness
  warnings, not new Phase 7 failures.
- Redux serializable middleware warnings still appear in the existing email
  delivery test harness because those tests build a real store in development
  mode. That is also pre-existing harness noise rather than a Phase 7 failure.
