# System Phase 6 Strategy Factory

Phase 6 freezes the strategy-factory contract across:

- `/strategy-template`
- `/strategy-lab`
- `/strategy-library`
- `/backtests`
- `/discovery`

The system no longer treats those surfaces as isolated tools. They now share one
cross-page lifecycle model for reusable templates, lab drafts, scoped library
entries, and validation runs, with discovery explicitly attached as the intake
end of the same factory.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/strategyFlowLinks.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/strategyFactoryWorkspace.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/strategyFactoryWorkspace.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/StrategyFactoryRail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyTemplate/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLab/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLibrary/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Backtests/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Backtests/useBacktestsSelectedRunModel.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Backtests/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLibrary/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## What Phase 6 Adds

### 1. Shared Strategy Factory Route Contract

The canonical lifecycle handoff now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/strategyFlowLinks.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/strategyFactoryWorkspace.js`

Supported shared lifecycle context:

- `templateId`
- `projectId`
- `libraryId`
- `backtestId`

Those keys now persist when operators move between:

- reusable templates
- strategy lab drafts
- saved library entries
- backtest review
- discovery intake

The helper also freezes:

- strategy-factory tab metadata
- canonical lifecycle path building
- shared context chips used in the rail
- page-aware context recovery from existing `selected` query state

### 2. Shared Strategy Factory Rail

Each strategy surface now renders the same strategy-factory rail via:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/StrategyFactoryRail.jsx`

That rail adds:

- a common factory banner
- preserved template / draft / library / backtest chips
- cross-page lifecycle tabs
- a page-local clear action that removes shared context without blindly dropping
  the current local workspace

This is the Phase 6 freeze point for strategy navigation and lifecycle handoff.

### 3. Strategy Pages Now Carry Lifecycle Context

#### Strategy Templates

- `/strategy-template` now reads the shared lifecycle context and preserves it
  when operators move between preview, editor, Strategy Lab, and Strategy Library
- create/edit transitions no longer discard the linked draft or backtest thread

#### Strategy Lab

- `/strategy-lab` now carries template, draft, library, and backtest lineage
  through save, reopen, send-to-backtests, and source-template handoff
- loading and error states still expose the same shared factory rail

#### Strategy Library

- `/strategy-library` now preserves lifecycle context while changing catalog
  filters, triage toggles, drawer state, and backtest/template handoffs
- the library URL bug that dropped `scopeReady=false` has been fixed at the
  shared route-builder layer

#### Backtests

- `/backtests` now exposes the shared strategy-factory rail above the local
  backtest desk tabs
- lineage actions now carry upstream template / draft / library context into the
  destination page instead of opening isolated pages

#### Discovery

- `/discovery` now participates in the same lifecycle rail
- template and backtest actions opened from discovery review now preserve the
  current factory context instead of acting like one-off exits

### 4. Discovery Is Now Explicitly in the Same Lifecycle

Phase 6 makes a strong product decision:

- Discovery is no longer a detached AI experiment page
- it is the intake edge of the same strategy factory

That matters because it gives the product one consistent answer to:

- where a discovered idea becomes a reusable template
- where a draft becomes a validation run
- where a validation run keeps its upstream lineage visible

## Intentional Phase 6 Boundaries

Phase 6 does not:

- merge all five strategy surfaces into one single route
- replace each page’s local workspace controls with one giant shared state store
- remove page-specific tabs such as Discovery `Overview / Operate / Review / Observe`
- redesign every internal strategy module
- merge backend APIs for templates, library, backtests, and discovery

This phase is about lifecycle continuity first, not collapsing all strategy work
into one page.

## Phase 7 Entry Criteria

Phase 7 can now build on a stable strategy factory:

- shared lifecycle context survives handoff across all five strategy surfaces
- the strategy factory rail is consistent across templates, lab, library,
  backtests, and discovery
- backtest lineage actions now preserve upstream strategy context
- discovery is attached to the same lifecycle instead of behaving like a sidecar
- library filter URLs and lifecycle URLs now preserve important state correctly

Recommended Phase 7 focus:

- consolidate the operations workspace
- unify Alerts, Activity, Automations, Schedulers, and Email into one ops model
- apply the same “shared workspace contract first” pattern used in Phases 5 and 6

## Verification

Focused verification completed:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/eslint src/helpers/strategyFlowLinks.js src/helpers/strategyFactoryWorkspace.js src/helpers/strategyFactoryWorkspace.test.js src/components/common/StrategyFactoryRail.jsx src/pages/StrategyTemplate/index.jsx src/pages/StrategyLab/index.jsx src/pages/StrategyLibrary/index.jsx src/pages/StrategyLibrary/index.test.jsx src/pages/Backtests/index.jsx src/pages/Backtests/index.test.jsx src/pages/Backtests/useBacktestsSelectedRunModel.js src/pages/Discovery/index.jsx src/pages/Discovery/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/helpers/strategyFactoryWorkspace.test.js src/pages/StrategyTemplate/index.test.jsx src/pages/StrategyLab/index.test.jsx src/pages/StrategyLibrary/index.test.jsx src/pages/Backtests/index.test.jsx src/pages/Discovery/index.test.jsx`

Observed test noise:

- React Router v7 future-flag warnings still appear in the existing Vitest/jsdom setup.
  They are pre-existing harness warnings, not new Phase 6 failures.
