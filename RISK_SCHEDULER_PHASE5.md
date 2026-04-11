# Risk Scheduler Phase 5

Phase 5 freezes diagnostics summary and blocker truth for `risk-recompute-sync`.

## Goal

Lock the operator-facing summary contract now that Phase 4 froze runtime audit
payloads:

- `usersTargeted`
- `usersWithFreshSnapshot`
- `usersMissingSnapshot`
- `usersWithSourceBlockers`
- ordered blocker aggregates
- `latestRun.initiatedBy`
- `latestRun.executionContext`

This phase keeps the summary truthful even when there are zero eligible target
users.

## What Changed

### 1. Latest recompute lineage now stays visible in the diagnostics summary

`RiskSchedulerService.getSchedulerDiagnosticsSummary(...)` now carries summary
lineage through `latestRun` with:

- `initiatedBy`
- `executionContext`

That keeps the diagnostics surface aligned with the runtime audit metadata that
Phase 4 already froze on run and update-log payloads.

### 2. Blocker truth stays stable and ordered

The summary keeps these top-level diagnostics counts:

- `usersTargeted`
- `usersWithFreshSnapshot`
- `usersMissingSnapshot`
- `usersWithSourceBlockers`

And it keeps blocker aggregates emitted in the stable risk order:

- `missing_snapshot`
- `missing_funds_snapshot`
- `missing_positions_snapshot`
- `stale_snapshot`

### 3. Zero-target diagnostics summaries stay cheap and explicit

When there are no real user-owned risk targets, Phase 5 freezes the contract
that:

- returns zero counts
- returns an empty blocker list
- keeps `latestRun` if one exists
- skips downstream snapshot, control, alert, and scenario lookups

That prevents unnecessary diagnostics queries while keeping the operator view
clear.

### 4. Health output now mirrors blocker truth

`check-risk-scheduler-health.ts` now logs:

- blocker details instead of only a blocker count
- latest run lineage fields from the diagnostics summary

That makes the live health artifact match the Phase 5 summary contract instead
of flattening the same information away.

## Non-Negotiables After Phase 5

- diagnostics summaries must keep the top-level targeted and blocker counts
- `latestRun` must keep recompute lineage through `initiatedBy` and
  `executionContext`
- blocker output must stay stable and ordered
- zero-target diagnostics summaries skip downstream snapshot lookups
- Phase 6 must build on this summary truth instead of redesigning it

## Phase 6 Entry Checklist

1. Localize diagnostics display timestamps for admin users without changing the
   underlying summary truth fields.
2. Extend user-timezone rendering consistently across summary, run history, and
   health/reporting surfaces.
3. Keep raw UTC truth available while adding localized display values where the
   operator surface needs them.
4. Phase 6 should focus on localized display rendering for diagnostics timestamps rather than changing diagnostics truth fields.

## Verification

Phase 5 completion used:

- `npm run test:risk-scheduler-phase5`
- `npm run test:risk-scheduler-phase4`
- `npm run test:risk-scheduler-phase3`
- `npm run test:risk-scheduler-phase2`
- `npm run test:risk-scheduler-phase1`
- `npm run test:controllers`
- `npm run type-check`
