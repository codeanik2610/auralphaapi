# Broker Assets Phase 5

Phase 5 promotes `broker_assets` from a schema-transition rollout to a
steady-state contract.

## Stable Contract

- `broker_assets` is the global provider or exchange catalog.
- Global rows are keyed by `source`, with optional `broker_id` linkage when a
  broker master record applies.
- User visibility is derived from owned `connections` and active
  `broker_accounts` with status `Connected` or `Idle`.
- Runtime sync writers only populate the global catalog through
  `ExchangeAssetRepository.replaceSystemAssets()`.
- User-visible asset reads only use `listVisibleAssetsForUser()` and
  `listVisibleAssetsBySourceAndSymbolsForUser()`.
- Delta order product lookup resolves against the global `delta_exchange`
  catalog.
- Global uniqueness remains `(source, symbol)`.
- `(source, externalId)` and `(source, assetId)` remain lookup indexes, not
  unique constraints, because the observed `delta_exchange` catalog still
  reuses those identifiers across multiple symbols.

Phase 4 keeps the schema-migration history in
`1770709000000-DropBrokerAssetLegacyUserOwnership.ts`. Phase 5 locks the
runtime and verification surface to the resulting ownership model.

## Stable Guardrails

- `npm run test:broker-assets-contract` is the steady-state contract guard.
- `npm run test:broker-assets-flow` is the focused runtime proof for:
  sync global catalog -> user-visible asset list -> Delta product lookup.
- `npm run test:broker-assets` is the stable umbrella suite used by
  `test:all`.
- `npm run release-gate:broker-assets` runs the broker-assets contract suite,
  flow proof, and broker-assets scoped lint checks.

## Naming Policy

- User-facing and schema-facing ownership language should use `broker_assets`.
- Historical `exchange_assets` names can remain inside old migrations,
  rollback helpers, and legacy fixtures until a dedicated no-behavior cleanup
  phase is scheduled.
- The `ExchangeAsset` class and `ExchangeAssetsService` names remain
  compatibility code symbols; the steady-state contract is enforced by the
  broker-assets tests above.

## Phase 6 Entry Checklist

1. Decide whether to archive the historical Phase 1-4 broker-assets guard
   scripts once the steady-state contract has burned in.
2. If desired, add a live broker-assets proof against a running local stack or
   staging API without mixing it into the default release gate.
3. Plan any non-functional rename pass for `ExchangeAsset` or legacy
   `exchange_assets` identifiers separately from behavior work.
4. Revisit lookup-constraint strategy only if observed provider data proves
   `(source, externalId)` or `(source, assetId)` unique for every supported
   source.

All four Phase 6 entry items were completed in `BROKER_ASSETS_PHASE6.md`.
