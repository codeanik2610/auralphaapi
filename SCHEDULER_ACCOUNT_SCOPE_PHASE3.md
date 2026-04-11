# Scheduler Account Scope Phase 3

Date: 2026-04-11

## 1) Goal
Phase 3 freezes the layering contract after the Phase 2 funds fix.

The important rule is not only "exclude system accounts" but also "exclude them
in the right place."

For `funds-sync`, `orders-sync`, and `positions-sync`:

- `BrokerAccountRepository` must stay generic
- ownerless `broker_accounts` rows must be filtered at the scheduler or
  internal-sync service layer
- scoped replay logic must still reject ownerless rows even when it starts from
  a generic all-accounts repository read

## 2) What Changed
### BrokerAccountRepository stays generic
`BrokerAccountRepository.ts` remains the shared account-access layer.

Phase 3 freezes that:

- `getAllActiveBrokerAccounts()` stays a generic "all connected or idle accounts"
  read
- `getActiveSystemBrokerAccounts()` stays available for true system-account
  workflows
- this repository must not be changed into an implicit `user_id IS NOT NULL`
  helper just to satisfy funds or sync-specific behavior

### Ownerless exclusion stays in the scheduler services
Phase 3 treats the scheduler services as the ownership boundary for these
three flows:

- `FundsSchedulerService.groupInfraAccountsByOwner()`
- `InternalOrdersSyncService.groupInfraAccountsByOwner()`
- `InternalPositionsSyncService.groupInfraAccountsByOwner()`

Each of those paths now owns the rule:

- skip rows whose `userId` is empty
- batch only real user-owned accounts
- keep the generic repository reusable for other system flows

### Orders scoped replay still filters after the generic repository read
`OrdersSchedulerService.resolveScopedOrdersRun()` still reads from
`getAllActiveBrokerAccounts()` and then explicitly removes ownerless matches.

That means replay remains an operational subset of the global scheduler instead
of turning the repository itself into a user-only abstraction.

## 3) Non-Negotiables After Phase 3
- `BrokerAccountRepository.getAllActiveBrokerAccounts()` must remain generic.
- `funds-sync`, `orders-sync`, and `positions-sync` must exclude ownerless
  system accounts in service-layer grouping or scoping logic.
- `OrdersSchedulerService` scoped replay must keep rejecting ownerless broker
  accounts after the generic lookup.
- No repository-level shortcut should be introduced that silently changes shared
  "all active accounts" semantics into "all active user-owned accounts."

## 4) Phase 4 Entry Checklist
1. Extend route and operator coverage for `/internal/funds/snapshot`,
   `/internal/orders/sync`, and `/internal/positions/sync` under scoped filters.
2. Add live-facing diagnostics guards so account totals cannot drift back from
   `4` to `6`.
3. Verify future scheduler features reuse the service-layer exclusion instead of
   reintroducing repository-level scope drift.

## 5) Verification
Phase 3 verification uses:

- `npm run test:scheduler-account-scope-phase3`
- `npm run test:funds-scheduler-phase1`
- `npm run test:positions-orders-sync-phase4`
- `npm run test:schedulers-phase4`
- `npm run type-check`
