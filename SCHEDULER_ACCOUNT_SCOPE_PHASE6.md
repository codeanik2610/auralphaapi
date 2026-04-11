# Scheduler Account Scope Phase 6

Date: 2026-04-11

## 1) Goal

Phase 6 archives the live ownership-alignment evidence and adds an operator
proof path for:

- `funds-sync`
- `orders-sync`
- `positions-sync`

By the end of this phase:

- the Phase 5 localhost proof still validates the real `4` user-owned / `2`
  system-owned broker-account split
- operators can persist that proof as a reusable artifact instead of only a
  terminal log line
- the repo explicitly records the rollout decision for this proof workflow

## 2) What Changed

### The live check now writes a reusable evidence snapshot

Phase 6 keeps:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-scheduler-account-scope-live.ts`
- `npm run check:scheduler-account-scope-live`

The script now:

- exports `buildSchedulerAccountScopeLiveSnapshot`
- exports `assertSchedulerAccountScopeLiveSnapshot`
- writes `artifacts/scheduler-account-scope-live.json`
- preserves the same live assertions from Phase 5

### A dedicated proof command now exists

Phase 6 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-scheduler-account-scope-live.ts`
- `npm run proof:scheduler-account-scope-live`

The proof command:

1. rebuilds the live scheduler account-scope snapshot
2. reasserts the `broker_accounts.user_id IS NOT NULL` ownership contract
3. persists the latest live snapshot
4. writes `artifacts/scheduler-account-scope-live-proof.json` with the proof
   decision, counts, account ids, and file references

## 3) Operational Decision

Phase 6 makes the Phase 5 decision explicit:

- scheduler account-scope live proof remains a manual smoke proof, not an automatic release gate
- `npm run proof:scheduler-account-scope-live` is the preferred operator entry
  point when rollout evidence is needed
- `test:all` keeps the static Phase 3 and Phase 5 and Phase 6 guards, but does
  not run the live proof command automatically

## 4) Phase 6 Outcome

The scheduler account-scope track now has both:

1. a static contract that prevents ownership-filter regressions
2. a live proof command that can emit reusable evidence for the current runtime

That means the `4` user-owned / `2` system-owned split is no longer only
observable during a one-off terminal session. It can now be captured in
artifacts for rollout notes or operator handoff.

## 5) Phase 7 Entry Checklist

1. Decide whether scheduler account-scope needs a dedicated release gate or
   signoff workflow beyond the manual smoke proof.
2. Add human evidence fields only if promotion or audit review now requires
   approver names, ticket ids, or dashboard links.
3. Extend the proof surface only if new scheduler endpoints or products expose
   account totals that must obey the same ownership contract.

## 6) Verification

Phase 6 verification uses:

- `npm run test:scheduler-account-scope-phase3`
- `npm run test:scheduler-account-scope-phase5`
- `npm run test:scheduler-account-scope-phase6`
- `npm run type-check`
- `npm run proof:scheduler-account-scope-live`

All three Phase 7 carry-forward items were addressed in `SCHEDULER_ACCOUNT_SCOPE_PHASE7.md`.
