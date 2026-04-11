## Positions And Orders Sync Phase 7

Phase 7 closes the positions-specific operational contract on top of the shared
Phase 6 timezone/display freeze.

This phase is intentionally about `positions-sync`, not `orders-sync`:

- `positions-sync` now has a frozen positions-only operator contract for
  owner-aware sync-state diagnostics, read-model recovery policy, scoped
  rebuild, and persisted recovery history.
- The admin scheduler surface keeps these recovery tools under
  `/scheduler/positions` and does not leak them into product-owned desk routes.
- The live `/positions` desk remains own-user only; product refresh continues
  to delegate through the product-owned internal sync contract with
  `targetUserIds: [userId]`.
- The dedicated runtime proof for positions-specific diagnostics and recovery
  stays in `npm run test:positions-scheduler-phase7`.
- The shared Phase 7 handoff is now frozen by
  `npm run test:positions-orders-sync-phase7`.

Phase 8 should focus only on `orders-sync` operational surfaces without
redefining the frozen `positions-sync` recovery and trust-boundary contract.

