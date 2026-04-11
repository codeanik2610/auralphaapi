# Scheduler Account Scope Phase 7

Date: 2026-04-11

## 1) Goal

Phase 7 turns scheduler account-scope into a release-ready workflow.

By the end of this phase:

- the scheduler account-scope track has a release gate that can optionally run
  the live ownership proof
- the track has a final signoff step that records explicit operator
  verification for the ownership split and scheduler surfaces
- the operational audit treats the scheduler account-scope workflow as a
  required backend release surface

Phase 7 does not change the `user_id IS NOT NULL` ownership rule again.
It makes the existing `4` user-owned / `2` system-owned contract releasable.

## 2) What Changed

### Scheduler account-scope now has a release gate

Phase 7 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-scheduler-account-scope.ts`
- `npm run release-gate:scheduler-account-scope`

The release gate runs:

- backend scheduler account-scope Phase 3 suite
- backend scheduler account-scope Phase 5 suite
- backend scheduler account-scope Phase 6 suite
- backend scheduler account-scope Phase 7 suite
- backend operational audit
- optional live proof via `SCHEDULER_ACCOUNT_SCOPE_RUN_LIVE_PROOF=true`

It writes the gate result to:

- `artifacts/scheduler-account-scope-release-gate.json`

When live proof is enabled, the gate also carries the proof artifact path and
parsed proof payload.

### Scheduler account-scope now has a final signoff workflow

Phase 7 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-scheduler-account-scope.ts`
- `npm run signoff:scheduler-account-scope`

The signoff script consumes the release-gate artifact and can optionally
require the Phase 6 live proof artifact.

It records explicit operator verification for:

- the `broker_accounts.user_id IS NOT NULL` ownership split
- `orders-sync` diagnostics alignment
- `positions-sync` diagnostics alignment
- `funds-sync` ownerless-account exclusion

It writes the signoff result to:

- `artifacts/scheduler-account-scope-signoff.json`

### Focused Phase 7 coverage now exists

Phase 7 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-scheduler-account-scope-phase7.ts`
- `npm run test:scheduler-account-scope-phase7`

That focused suite verifies:

- the signoff script succeeds against a ready gate plus ready proof artifact
- the release gate supports optional live proof execution
- package wiring, README notes, and operational audit all include the Phase 7
  release workflow markers

## 3) Phase 7 Outcome

Scheduler account-scope now has a clean release chain instead of only a manual
proof command:

1. `npm run test:scheduler-account-scope-phase3`, Phase 5, Phase 6, and Phase 7 freeze the contract
2. `npm run proof:scheduler-account-scope-live` captures the live ownership proof artifact
3. `npm run release-gate:scheduler-account-scope` aggregates the backend release checks and can optionally carry the live proof
4. `npm run signoff:scheduler-account-scope` records final operator verification and evidence posture

That is the stable baseline Phase 8 can now build on.

## 4) Carry-Forward For Phase 8

- update `proof:scheduler-account-scope-live` or add a dedicated proof wrapper
  so it runs the release gate with live proof enabled and then runs
  `signoff:scheduler-account-scope` to emit one combined proof artifact
- run the scheduler account-scope release gate and signoff against the target
  environment with real evidence links and human approval metadata
- keep the ownership contract frozen while deciding whether broader scheduler
  rollout evidence should share this workflow

## 5) Verification

Phase 7 verification uses:

- `npm run test:scheduler-account-scope-phase6`
- `npm run test:scheduler-account-scope-phase7`
- `npm run release-gate:scheduler-account-scope`
- `SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_GATE_FILE=artifacts/scheduler-account-scope-release-gate.json SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_PROOF_FILE=artifacts/scheduler-account-scope-live-proof.json SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_REQUIRE_LIVE_PROOF=true SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_OWNERSHIP_SPLIT_VERIFIED=true SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_ORDERS_DIAGNOSTICS_VERIFIED=true SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_POSITIONS_DIAGNOSTICS_VERIFIED=true SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_FUNDS_OWNERLESS_EXCLUSION_VERIFIED=true SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED=true SCHEDULER_ACCOUNT_SCOPE_SIGNOFF_APPROVER=codex-phase7 npm run signoff:scheduler-account-scope`
- `npm run test:operational-audit`

`proof:scheduler-account-scope-live` remains the standalone manual proof in
this phase. Turning it into the final combined release proof is the intended
Phase 8 step.
