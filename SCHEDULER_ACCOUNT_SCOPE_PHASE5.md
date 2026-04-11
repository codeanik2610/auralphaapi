# Scheduler Account Scope Phase 5

Date: 2026-04-11

## 1) Goal
Phase 5 turns the scheduler account-scope fix into one repeatable live proof.

By the end of this phase we should be able to run one command that proves:

- MySQL still has the expected split between user-owned and system-owned active
  broker accounts
- `orders-sync` live sync-state totals only report user-owned accounts
- `positions-sync` live sync-state totals only report user-owned accounts
- `funds-sync` internal batch execution only processes user-owned accounts even
  when the request target is the system scheduler user

## 2) What Changed
### One live proof command now exists
Phase 5 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-scheduler-account-scope-live.ts`
- `npm run check:scheduler-account-scope-live`

The live check:

1. logs into the localhost API as the seeded admin user
2. reads active broker-account counts directly from MySQL
3. verifies `/scheduler/orders/sync-state/summary` and
   `/scheduler/orders/sync-state` match the live user-owned account count
4. verifies `/scheduler/positions/sync-state/summary` and
   `/scheduler/positions/sync-state` match the live user-owned account count
5. calls `/internal/funds/snapshot` for the system scheduler user and verifies
   the batch total also matches the user-owned account count
6. reruns `/internal/funds/snapshot` scoped only to ownerless account ids and
   proves those rows are ignored with a zero-account result

### Focused Phase 5 guard now exists
Phase 5 also adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-scheduler-account-scope-phase5.ts`
- `npm run test:scheduler-account-scope-phase5`

That suite freezes the operator contract so later refactors cannot remove or
partially unwind the live proof command.

## 3) Outcome
The account-scope work now has a truthful end-to-end proof surface:

- static guards freeze the layering contract
- existing sync suites freeze the batch behavior
- the new live proof command compares real API totals against the real database
  ownership split

That means we no longer have to infer whether the platform is treating `4`
user-owned accounts and `2` system-owned accounts correctly. We can prove it in
one command.

## 4) Phase 6 Entry Checklist
1. Decide whether this live proof should become a release-gate prerequisite or
   a recurring smoke check.
2. Capture operator-facing artifacts from the live proof run if promotion or
   rollout signoff is needed.
3. Extend the proof only if future scheduler surfaces introduce new account
   totals that must stay aligned with the same `user_id IS NOT NULL` contract.

## 5) Verification
Phase 5 verification uses:

- `npm run test:scheduler-account-scope-phase5`
- `npm run test:scheduler-account-scope-phase3`
- `npm run type-check`
- `npm run check:scheduler-account-scope-live`

All three Phase 6 entry items were addressed in `SCHEDULER_ACCOUNT_SCOPE_PHASE6.md`.
