## Positions And Orders Sync Phase 9

Phase 9 closes the shared proof, regression, and signoff workflow for
`positions-sync` and `orders-sync`.

This phase keeps the two scheduler tracks separate operationally, but freezes
one shared handoff posture:

- `positions-sync` continues to use its dedicated live health, release gate,
  signoff, and live proof workflow:
  - `npm run check:positions-scheduler-health`
  - `npm run release-gate:positions-scheduler`
  - `npm run signoff:positions-scheduler`
  - `npm run proof:positions-scheduler-live`
- `orders-sync` continues to use its dedicated live health, release gate,
  signoff, and live proof workflow:
  - `npm run check:orders-scheduler-health`
  - `npm run release-gate:orders-scheduler`
  - `npm run signoff:orders-scheduler`
  - `npm run proof:orders-scheduler-live`
- The shared backend guard is now `npm run test:positions-orders-sync-phase9`.
- Phase 9 should treat the proof layer as frozen: both proof scripts must
  require ready release-gate output, ready signoff output, and explicit
  operator acknowledgements before succeeding.

Phase 10 should only extend deployment-evidence depth or promotion posture. It
should not redefine the frozen proof/signoff contract for `positions-sync` or
`orders-sync`.

