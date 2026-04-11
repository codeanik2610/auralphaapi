# System Phase 2 Shell

Phase 2 turns the frozen Phase 1 information architecture into a real shell layer.
This phase does not redesign page internals yet. It adds shared shell primitives so
Phase 3 can rebuild the command workspace on top of a stable navigation frame.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/workspaceShell.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/Topbar.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/WorkspaceShellRail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/layouts/DashboardLayout.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## What Phase 2 Adds

### 1. Workspace-Aware Topbar

The topbar is no longer a theme-toggle-only strip. It now includes:

- current workspace and route context
- global command/search entry
- recent object launcher
- global inbox launcher
- existing sidebar toggle and theme toggle

The topbar still does not own page-specific actions. Those remain with each page.

### 2. Command/Search Bar

The shell command bar now searches:

- recent objects
- current workspace routes
- other canonical routes

It is route-driven, not backend-driven. This is intentional for Phase 2.
Phase 3 can attach a unified action queue or richer object graph later without
replacing the shell surface.

### 3. Recent Objects

Recent shell context is persisted in:

- `auralpha-shell:recent-objects`

Stored items capture:

- route path
- search string
- workspace title
- route title
- inferred object label from common query parameters

This is shell memory, not product truth. It exists to speed return navigation.

### 4. Global Inbox Entry

The topbar inbox is now a launcher into:

- Alerts
- Signals
- Suggested Trades
- Activity
- Automations

It is not yet the final unified queue. Phase 2 only establishes the shell entry point.
Phase 3 should decide how much of this becomes a true command-center inbox.

### 5. Workspace Rail

Every authenticated page now renders a shared workspace rail below the topbar.
The rail provides:

- workspace focus context
- current route chip
- sticky second-level workspace tabs

This creates a consistent second-level navigation layer across the shell.

## Intentional Phase 2 Boundaries

Phase 2 does not:

- merge alerts, signals, suggested trades, and activity into one backend queue
- remove individual page headers
- redesign page internals
- add role-based workspace presets
- replace page-local tabs with global shell tabs

## Phase 3 Entry Criteria

Phase 3 can now focus on rebuilding the command workspace because the shell contract exists:

- canonical workspace rail is in place
- command/search has a stable entry surface
- recent object persistence exists
- inbox entry point exists
- route context is visible globally

Recommended Phase 3 target:

- turn `Overview` into a real command center
- define `Now / Markets / Book / Automation` within the command workspace
- decide how the shell inbox collapses into a single prioritized queue

## Verification

Phase 2 verification was focused on:

- workspace shell helpers
- topbar search and launchers
- workspace rail navigation
- continued Phase 1 route/auth/sidebar behavior
