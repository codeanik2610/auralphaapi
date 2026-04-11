# System Phase 5 Execution Desk

Phase 5 freezes the execution desk contract across `/orders`, `/positions`,
`/portfolio`, and `/risk-center`.

The system no longer treats those pages as four isolated execution surfaces.
They now share one cross-page context model for broker, account, and symbol
handoff, and each page exposes the same execution-desk rail so operators can
move across the live book without rebuilding context manually.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/executionWorkspace.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/executionWorkspace.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/ExecutionWorkspaceRail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## What Phase 5 Adds

### 1. Shared Execution Desk Route Contract

The canonical shared execution context now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/executionWorkspace.js`

Supported shared query context:

- `symbol`
- `broker`
- `account`

Those keys now persist when operators move between:

- `/orders`
- `/positions`
- `/portfolio`
- `/risk-center`

The helper also freezes:

- execution desk tab metadata
- canonical cross-desk path building
- common execution activity link building
- shared context chips used in the UI rail

### 2. Shared Execution Desk Rail

Each execution page now renders the same execution-desk rail via:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/ExecutionWorkspaceRail.jsx`

That rail adds:

- a common execution-desk banner
- preserved broker / account / symbol chips
- cross-page execution tabs
- one shared “Open execution activity” handoff
- a reset action to clear shared context on the current page

This is the Phase 5 freeze point for execution navigation and operator handoff.

### 3. Orders, Positions, Portfolio, and Risk Center Now Carry Context

#### Orders

- `/orders` now reads and syncs `tab`, `broker`, `account`, `symbol`, and `selected`
- query-based `selected` hydration can reopen an order detail when the order is
  present in the loaded open/history/paper slices
- broker and account route selections now stay visible in the shared execution rail

#### Positions

- `/positions` now treats `symbol` as part of the shareable desk contract
- inbound `symbol` can seed the initial search state when no explicit search is present
- selected-position context now flows into the execution rail and common activity handoff

#### Portfolio

- `/portfolio` now keeps execution symbol context alongside its existing
  `timeframe`, `focus`, `search`, and `selected` shareable state
- inbound `symbol` can seed holdings search when no explicit holdings search is present
- the execution rail makes it explicit that portfolio remains aggregate even while
  shared execution focus is preserved

#### Risk Center

- `/risk-center` now syncs `policy`, `policyTab`, `window`, `symbol`, `broker`, and `account`
- history-tab URLs can reopen the policy drawer when the selected rule is available
- broker-scoped risk review now participates in the same execution handoff contract

### 4. One Common Execution Activity Handoff

All four execution surfaces now use one shared activity-link contract that points
into `/activity` with execution-scoped filters.

This is intentionally lighter than a full merged activity widget on every page.
Phase 5 freezes the handoff path first, so Phase 6 can build deeper operational
behavior on top of a stable cross-desk contract.

## Intentional Phase 5 Boundaries

Phase 5 does not:

- merge the four execution pages into one single route
- replace each page’s local workflow controls with a global desk state store
- remove page-specific filters such as portfolio timeframe or positions date windows
- redesign the inner modules of Orders, Positions, Portfolio, or Risk Center
- merge backend APIs into one execution endpoint

This phase is about cross-page execution continuity, not about collapsing all
execution logic into one screen.

## Phase 6 Entry Criteria

Phase 6 can now build on a stable execution desk:

- broker / account / symbol focus survives execution handoff
- Orders can reopen selected details from the URL contract
- Positions, Portfolio, and Risk Center now participate in the same execution rail
- the execution activity handoff is consistent across the desk
- shareable execution URLs are no longer page-by-page ad hoc

Recommended Phase 6 focus:

- clean the strategy factory and its lifecycle handoffs
- reduce overlap between Strategy Templates, Strategy Lab, Strategy Library,
  Backtests, and Discovery
- apply the same “single workspace contract first” discipline used in Phases 4 and 5

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/helpers/executionWorkspace.js src/helpers/executionWorkspace.test.js src/components/common/ExecutionWorkspaceRail.jsx src/pages/Orders/index.jsx src/pages/Positions/index.jsx src/pages/Portfolio/index.jsx src/pages/RiskCenter/index.jsx src/pages/Positions/index.test.jsx src/pages/Portfolio/index.test.jsx src/pages/RiskCenter/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/helpers/executionWorkspace.test.js src/pages/Positions/index.test.jsx src/pages/Portfolio/index.test.jsx src/pages/RiskCenter/index.test.jsx`

Observed test noise:

- React Router v7 future-flag warnings still appear in the existing Vitest/jsdom setup.
  They are pre-existing harness warnings, not new Phase 5 failures.
