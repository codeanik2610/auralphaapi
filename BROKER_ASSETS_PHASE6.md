# Broker Assets Phase 6

Phase 6 archives the rollout history and adds a live operational proof path for
`broker_assets`.

## Implemented Behavior

- The historical Phase 1-4 broker-assets guards are now archived behind
  `npm run test:broker-assets-history`.
- The steady-state broker-assets umbrella remains `npm run test:broker-assets`;
  rollout-history checks are no longer part of the default broker-assets suite
  or `test:all`.
- `npm run check:broker-assets-health` performs a live broker-assets health
  probe against:
  - `/health/queue`
  - `/health/worker`
  - `/scheduler/exchange-assets/config`
  - `/scheduler/exchange-assets/assets`
  - `/exchange-assets`
- `npm run proof:broker-assets-live` runs the broker-assets release gate and
  then the live health check, writing evidence to
  `artifacts/broker-assets-live-proof.json`.
- No schema or runtime ownership rules changed in this phase.

## Operational Decisions

- The compatibility symbols `ExchangeAsset`, `ExchangeAssetRepository`, and
  `ExchangeAssetsService` are intentionally not renamed in Phase 6.
- `(source, externalId)` and `(source, assetId)` remain non-unique lookup
  indexes. The observed `delta_exchange` catalog still disproves a safe unique
  constraint for those keys.
- Live broker-assets proof remains opt-in and is not wired into the default
  release gate or `test:all`.

## Archived History

- `npm run test:broker-assets-history` preserves the original Phase 1-4
  rollout guard chain for regression archaeology.
- `npm run test:broker-assets-phase1` through
  `npm run test:broker-assets-phase4` remain available as direct one-off
  scripts when a migration-history investigation is needed.

## Phase 7 Entry Checklist

1. Decide whether to perform a dedicated no-behavior rename pass from
   `ExchangeAsset*` compatibility symbols to `BrokerAsset*`.
2. If deployment evidence is useful, wire `proof:broker-assets-live` into a
   manual promotion or release-evidence workflow instead of the default test
   lane.
3. Add source-specific health thresholds or minimum-visible-results checks once
   staging or production data is stable enough to support strict assertions.
4. Revisit provider identity and uniqueness rules only with observed
   source-specific data that proves a stronger constraint is safe.

All four Phase 7 entry items were addressed in `BROKER_ASSETS_PHASE7.md`.
