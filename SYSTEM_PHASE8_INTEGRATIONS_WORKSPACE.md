# System Phase 8 Integrations Workspace

Phase 8 freezes the integrations-workspace contract across:

- `/brokers-data`
- `/broker-definitions`

The system no longer treats broker connectivity and broker metadata as separate
admin islands. Operators can now move between live route setup, execution
accounts, reusable broker templates, and runtime diagnostics without losing the
active broker or account context.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/integrationsWorkspace.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/integrationsWorkspace.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/IntegrationsWorkspaceRail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokersData/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokersData/hooks/useBrokersDataSelection.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokersData/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokerDefinitions/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokerDefinitions/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/config/workspaceArchitecture.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## What Phase 8 Adds

### 1. Shared Integrations Handoff Contract

The canonical integrations handoff now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/integrationsWorkspace.js`

Supported shared integrations context:

- `broker`
- `account`

Those keys now persist when operators move between:

- live route and feed setup
- execution account review
- reusable broker definition review
- diagnostics and onboarding metadata

The helper also freezes:

- integrations-workspace tab metadata
- canonical cross-page path building
- shared context chips used in the rail
- clear-path behavior that strips only shared integrations context and keeps
  page-local tabs, drawers, and selections intact

### 2. Shared Integrations Rail

Each integrations surface now renders the same rail via:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/IntegrationsWorkspaceRail.jsx`

That rail adds:

- a common integrations handoff banner
- preserved broker / account chips
- cross-page integrations tabs
- a page-local clear action that removes the shared integrations context
  without resetting local page state

This is the Phase 8 freeze point for integrations navigation and admin
continuity.

### 3. Brokers Data Now Rebuilds Runtime Context from Shared Broker and Account

- `/brokers-data` now resolves shared broker and account context from the URL
- `useBrokersDataSelection` now accepts preferred broker and account keys from
  the integrations workspace
- when a live route or execution account is not already selected, the page can
  rebuild the working selection from the shared `broker` / `account` context
- the page keeps its own `routes / accounts` tab, selected connection, and
  selected account state while the shared integrations rail remains visible

This lets an operator jump in from broker metadata and land on the matching
live route surface without rebuilding the context by hand.

### 4. Broker Definitions Now Participate in the Same Integrations Model

- `/broker-definitions` now renders the shared integrations rail above the
  local `Catalog / Definition setup / Ops guide` workspaces
- the page derives broker and account context from the same shared
  integrations-query contract
- page-local tab selection is now URL-backed through `tab`
- initial broker selection no longer blindly rewrites the URL when the broker
  was not explicitly provided upstream
- the definition page can hand the operator back to `/brokers-data` while
  preserving the active broker and account context

This turns Broker Definitions into the metadata side of the same integrations
workspace instead of a disconnected admin screen.

### 5. Integrations Naming Is Now Frozen in the Shell

The shell architecture now describes the integrations workspace as:

- `Connections & Accounts`
- `Definitions & Diagnostics`

That naming now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/config/workspaceArchitecture.js`

This is the frozen Phase 8 information-architecture contract for integrations.

## Intentional Phase 8 Boundaries

Phase 8 does not:

- merge brokers data and broker definitions into one route
- create one shared backend API for broker connectivity and metadata
- redesign each page's local setup forms, validation rules, or operator guides
- add new broker diagnostics execution capabilities beyond the existing page
  controls
- introduce a new global integrations dashboard

This phase is about shared admin continuity first, not collapsing everything
into a single page.

## Phase 9 Entry Criteria

Phase 9 can now build on a stable integrations workspace:

- shared `broker / account` context survives handoff across both integrations
  surfaces
- the integrations rail is consistent across `/brokers-data` and
  `/broker-definitions`
- Brokers Data can rebuild its local working selection from shared context
- Broker Definitions preserves page-local tabs while participating in the same
  integrations handoff model
- clearing shared integrations context preserves local page state instead of
  resetting the whole page

Recommended Phase 9 focus:

- standardize the cross-page page skeleton
- align header / summary / tabs / list / detail / trust patterns across the
  major workspaces
- apply the same visual and interaction grammar across command, markets,
  execution, strategy, operations, and integrations

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/helpers/integrationsWorkspace.js src/helpers/integrationsWorkspace.test.js src/components/common/IntegrationsWorkspaceRail.jsx src/pages/BrokersData/index.jsx src/pages/BrokersData/hooks/useBrokersDataSelection.js src/pages/BrokersData/index.test.jsx src/pages/BrokerDefinitions/index.jsx src/pages/BrokerDefinitions/index.test.jsx src/config/workspaceArchitecture.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/helpers/integrationsWorkspace.test.js src/pages/BrokersData/index.test.jsx src/pages/BrokerDefinitions/index.test.jsx`

Observed test noise:

- React Router v7 future-flag warnings still appear in the existing
  Vitest/jsdom harness on some page tests. They are pre-existing harness
  warnings, not new Phase 8 failures.
