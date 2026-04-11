# Risk Scheduler Phase 2

Phase 2 freezes the admin scheduler surface for `risk-recompute-sync`.

## Goal

Lock the `/scheduler/risk/*` operator contract in place now that Phase 1
finished the ownership and scope split.

Phase 2 is about the admin control plane:

- config
- run
- pause or resume
- stop or restart
- purge
- diagnostics summary
- run history, progress, updates, and export

Phase 2 does not widen product trust. `/risk/recompute` remains own-user only,
and scheduler or cron execution still fans out through the all-users path that
Phase 1 froze.

## What Changed

### 1. The admin route surface is now an explicit baseline

Phase 2 freezes these routes on `/scheduler/risk`:

- `/scheduler/risk/config`
- `/scheduler/risk/run`
- `/scheduler/risk/pause`
- `/scheduler/risk/resume`
- `/scheduler/risk/stop`
- `/scheduler/risk/restart`
- `/scheduler/risk/purge-logs`
- `/scheduler/risk/purge-logs/preview`
- `/scheduler/risk/summary`
- `/scheduler/risk/runs`
- `/scheduler/risk/runs/:runId/progress`
- `/scheduler/risk/runs/:runId/updates`
- `/scheduler/risk/runs/:runId/updates/export`

### 2. Admin controls stay actor-owned

The scheduler record is user-owned, so Phase 2 freezes the control-plane
operations on actor-aware repositories:

- pending command cancellation stays actor-scoped
- stop and restart command handling stays actor-scoped
- queued-run cancellation stays actor-scoped
- purge preview and purge deletion stay actor-scoped
- runs, progress, updates, and export only resolve runs through the owning
  admin actor

### 3. Recompute writes and batch aggregation stay intact

Phase 2 keeps the existing risk recompute foundations in place:

- `RiskService.recomputeRiskSnapshot(...)` still computes and persists
  snapshots, controls, alerts, and scenarios
- `RiskService.recomputeRiskSnapshotBatch(...)` still aggregates per-user
  success and failure totals for batch execution

## Non-Negotiables After Phase 2

- `/scheduler/risk/*` remains the canonical admin scheduler surface
- actor-scoped admin control ownership must not drift back to global run-control
  behavior
- purge, run history, progress, updates, and export must stay scoped to the
  owning admin actor
- `/risk/recompute` remains outside this admin surface and stays own-user only
- scheduler or cron all-users execution behavior remains unchanged from Phase 1

## Phase 3 Entry Checklist

1. Freeze the internal `/internal/risk/recompute` execution contract.
2. Make the scheduler-vs-product execution split even more explicit in tests
   and docs.
3. Verify worker handoff payloads and target-user semantics without changing
   the admin route surface.
4. Phase 3 should focus on the internal execution contract rather than admin route churn.

## Verification

Phase 2 completion used:

- `npm run test:risk-scheduler-phase2`
- `npm run test:risk-scheduler-phase1`
- `npm run test:controllers`
- `npm run type-check`
