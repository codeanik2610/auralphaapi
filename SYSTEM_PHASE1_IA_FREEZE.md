# System Phase 1 IA Freeze

This document freezes the shell architecture for the next system redesign phases.
Phase 1 does not redesign each page yet. It defines the canonical workspace model,
the route ownership map, and the legacy compatibility rules that Phase 2 will build on.

## Source Of Truth

Frontend source of truth:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/config/workspaceArchitecture.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/config/navigation.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`

Phase 1 rules:

- Navigation sections are owned by one canonical workspace architecture file.
- Route labels used by auth redirects are derived from the same architecture map.
- `Strategy Lab` is a first-class workspace route and is visible in the shell navigation.
- `scheduler-ops` and `strategy-ops` remain supported only as legacy admin aliases to `/schedulers`.

## Canonical Workspaces

### 1. Command

- Purpose: prioritize what needs attention now.
- Current canonical route set:
  - `/overview`

### 2. Markets

- Purpose: scan markets and promote trade ideas.
- Current canonical route set:
  - `/markets`
  - `/watchlists`
  - `/signals`
  - `/suggested-trades`

### 3. Execution

- Purpose: operate the live book and its controls.
- Current canonical route set:
  - `/orders`
  - `/positions`
  - `/portfolio`
  - `/risk-center`

### 4. Strategy

- Purpose: build, validate, and promote strategy ideas.
- Current canonical route set:
  - `/strategy-template`
  - `/strategy-lab`
  - `/strategy-library`
  - `/backtests`
  - `/discovery`

### 5. Operations

- Purpose: monitor interventions, jobs, and delivery health.
- Current canonical route set:
  - `/alerts`
  - `/activity`
  - `/automations`
  - `/email-deliveries`
  - `/schedulers`

### 6. Integrations

- Purpose: own broker connectivity, metadata, and diagnostics.
- Current canonical route set:
  - `/brokers-data`
  - `/broker-definitions`

### 7. Settings

- Purpose: personal workspace controls.
- Current canonical route set:
  - `/settings`

## Legacy Compatibility

These routes are kept only to avoid breaking saved admin links and older operator habits:

- `/scheduler-ops` -> `/schedulers`
- `/strategy-ops` -> `/schedulers`

Rules:

- They are not first-class navigation destinations.
- They stay admin-guarded.
- They should be treated as aliases, not independent product surfaces.

`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/SchedulerOps/index.jsx`
is now legacy implementation debt. It should not drive future information architecture decisions.

## Phase 1 Shipped Decisions

- Renamed shell sections to the target workspace model:
  - `Command`
  - `Markets`
  - `Execution`
  - `Strategy`
  - `Operations`
  - `Integrations`
  - `Settings`
- Promoted `Strategy Lab` into first-class navigation under `Strategy`.
- Centralized route labels so auth redirects and shell naming cannot drift separately.
- Formalized scheduler aliases as legacy admin redirects instead of implied product pages.

## Phase 2 Entry Criteria

Phase 2 can now build the shell without re-deciding IA. The next phase should focus on:

- second-level workspace tabs
- a stronger topbar with command/search/global inbox entry points
- workspace-aware breadcrumbs and route context
- role-shaped defaults for admin, strategist, operator, and execution users

## Out Of Scope For Phase 1

- page redesigns
- merging or deleting pages
- global inbox implementation
- topbar redesign
- role-based navigation presets
