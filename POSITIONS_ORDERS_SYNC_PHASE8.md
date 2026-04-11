## Positions And Orders Sync Phase 8

Phase 8 closes the `orders-sync` operational contract on top of the shared
Phase 6 timezone/display freeze and the Phase 7 `positions-sync` freeze.

This phase is intentionally about `orders-sync`:

- `orders-sync` now has a frozen orders-only operator contract for runtime foundation diagnostics, checkpoint-aware sync-state truth, scoped replay, and checkpoint reset handling.
- The admin scheduler surface keeps replay and checkpoint tooling under
  `/scheduler/orders` and does not blur that work into product-owned `/orders`
  desk routes.
- The live `/orders` desk remains own-user only; product refresh continues to
  delegate through the product-owned internal sync contract with
  `targetUserIds: [userId]`.
- The dedicated runtime and controller proofs stay in
  `npm run test:schedulers-phase7` and `npm run test:schedulers-phase8`.
- The shared Phase 8 handoff is now frozen by
  `npm run test:positions-orders-sync-phase8` before Phase 9 proof/signoff work.

Phase 9 should focus on proof, regression, and signoff for both schedulers
without redefining the frozen `positions-sync` or `orders-sync` trust
contracts.
