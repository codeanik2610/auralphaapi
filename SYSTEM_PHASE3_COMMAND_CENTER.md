# System Phase 3 Command Center

Phase 3 rebuilds `Overview` into a real command workspace on top of the Phase 2 shell.
This phase changes the page model, not the global shell model. The goal is to make
`/overview` the first place an operator can understand what needs attention now before
branching into deeper product workspaces.

## Shipped Surface

Frontend source files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## What Phase 3 Adds

### 1. Real Command Workspace Tabs

`/overview` is no longer one long operator scroll. It is now explicitly split into:

- `Now`
- `Markets`
- `Book`
- `Automation`

The active tab is route-backed through the page query string:

- default: `/overview`
- other tabs: `/overview?tab=markets`, `/overview?tab=book`, `/overview?tab=automation`

This makes the command center shareable and gives Phase 4 a stable page-level contract.

### 2. Unified My Queue

The `Now` tab introduces a real cross-system queue assembled from:

- alerts digest
- live signals digest
- suggested trades list + summary
- risk overview alerts
- automation failure / degraded-health follow-up

This is intentionally a frontend-assembled queue for now. It proves the workflow and
freezes the operator model before Phase 4 decides whether a backend queue contract is needed.

### 3. Clear Workspace Boundaries Inside Overview

Each tab now owns a distinct job:

- `Now`: prioritized operator inbox and command posture
- `Markets`: focused market detail, opportunity board, and market-aligned signals/trades
- `Book`: stored portfolio posture plus live risk windows and exceptions
- `Automation`: automation digest, failures, and human follow-up

This removes the old ambiguity where the page mixed all of those concerns in one vertical surface.

### 4. Shared Refresh Behavior

Manual refresh and background polling now refresh:

- overview payload
- suggested trades queue
- suggested trade summary
- risk overview

That keeps the command workspace coherent instead of letting `Overview` drift away from
trade-review or risk-review state.

## Intentional Phase 3 Boundaries

Phase 3 does not:

- merge backend queue sources into one API
- redesign the full Markets, Risk Center, or Suggested Trades pages
- add backend prioritization logic for command items
- add role-aware personalization inside the command center
- remove page-level duplication from downstream workspaces

## Phase 4 Entry Criteria

Phase 4 can now build on a stable command model instead of re-deciding the page shape.
Recommended focus:

- unify the market pipeline across `Markets`, `Watchlists`, `Signals`, and `Suggested Trades`
- decide whether the command queue stays frontend-composed or graduates into a backend contract
- strengthen cross-page handoff from queue item -> deep workspace
- align symbol, trade, and alert context more consistently across workspaces

## Verification

Phase 3 verification was focused on the command-center surface itself:

- `npx eslint src/pages/Dashboard/index.jsx src/pages/Dashboard/index.test.jsx`
- `npm run test:ui -- src/pages/Dashboard/index.test.jsx`
