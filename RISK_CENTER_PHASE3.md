# Risk Center Phase 3

Date: 2026-04-09

## 1) Goal
Phase 3 for `/risk-center` focuses on UX reliability.

Now that Phase 2 made the data truthful, the page should load and refresh predictably, keep failure
states visible, show freshness/provenance cues where operators need them, and make the policy drawer
usable from the keyboard.

## 2) What Changed
### Fetch flow simplification
`/risk-center` no longer performs a second redundant alerts-overview fetch during page boot and page
refresh.

Updated frontend flow in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`:

- mount now hydrates the page from `fetchRiskOverview(...)`
- manual refresh and auto refresh now re-run the same overview fetch
- the page stops double-loading alerts from both overview and alerts-overview for the same screen

This removes overlapping state churn and keeps the risk-center page aligned to one overview payload.

### Clearer loading, refresh, and failure behavior
The page now distinguishes initial load from background refresh.

Phase 3 behavior:

- first load shows loading states without pretending stale data is available
- refreshes now say `Refreshing risk center snapshot...` when data is already on screen
- overview errors stay visible instead of disappearing quickly
- an explicit retry fallback appears when the page has no overview payload at all

### Freshness and provenance cues
The operator workspace now surfaces when the overview was refreshed and where key sections come
from.

Phase 3 provenance additions:

- top-level operator chips now show the latest overview refresh time
- the coverage note card repeats the overview refresh time
- risk-window detail now shows both the window-specific source label and the overview contract
  source label
- broker coverage now shows the overview broker-snapshot source plus metric-level funds and
  positions source labels on each broker card
- alert empty states now mention the latest overview refresh time when available

### Better empty states
Empty sections are more actionable and less generic.

Updated areas:

- controls empty state now explains that the current overview returned no persisted control rows
- scenarios empty state now explains that the current overview returned no persisted scenario rows
- policies empty state now tells the operator what first action to take
- first-load overview failure now gets a dedicated retry card instead of only a banner

### Accessibility and keyboard flow
The policy drawer and shared table interactions are now more reliable for keyboard users.

Phase 3 accessibility changes:

- the policy drawer now traps focus while open
- `Escape` closes the drawer
- focus returns to the button that opened the drawer
- the drawer now has `aria-labelledby` and `aria-describedby`
- drawer form fields now use explicit label/input associations
- clickable shared `DataTable` rows can now be activated with `Enter` or `Space`
- `StatusBanner` now uses stronger screen-reader semantics for danger banners

Frontend files updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/DataTable.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/DataTable.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/StatusBanner.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/common/StatusBanner.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## 3) Phase 3 Outcome
`/risk-center` now behaves like a reliable operator workspace instead of a page that only looks
polished when the happy path succeeds.

Refreshes are less noisy, failures are clearer, provenance is easier to trust, and the main policy
editing flow is keyboard-safe enough for Phase 4 lifecycle work.

## 4) Known Carry-Forward For Phase 4
- policy approval workflow still does not exist
- rollback UX for policy changes still does not exist
- policy save and recompute flows still need broader end-to-end coverage
- the page still edits policies directly instead of supporting approval, draft, or rollback states
- kill switch automation, capacity, and meaningful recompute remain outside the trusted operator
  lifecycle

## 5) Verification
Phase 3 verification passed with:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/RiskCenter/index.jsx src/pages/RiskCenter/index.test.jsx src/components/common/DataTable.jsx src/components/common/DataTable.test.jsx src/components/common/StatusBanner.jsx src/components/common/StatusBanner.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx src/components/common/DataTable.test.jsx src/components/common/StatusBanner.test.jsx`

The focused UI suite passed with only existing React Router v7 future-flag warnings.
