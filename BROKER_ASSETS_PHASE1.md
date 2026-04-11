# Broker Assets Phase 1

Phase 1 freezes the ownership contract for `broker_assets` before any runtime
refactor or destructive migration happens.

## Contract

- `broker_assets` is the global broker or exchange asset catalog.
- `broker_accounts` is the user-owned connection layer that tells us which user
  has access to which broker.
- `broker_assets.user_id` is a legacy transitional column. It must not be
  treated as required ownership or as the long-term source of truth.
- User-visible asset lists should ultimately be derived from the user's
  connected `broker_accounts` joined to the global `broker_assets` catalog.
- User-specific asset preferences, selections, or overrides do not belong in
  `broker_assets`. They must live in scheduler config or a dedicated
  user-owned table.

## Phase 1 Outcome

Phase 1 does not change runtime behavior. It does three things:

- documents the global-catalog ownership rule
- marks the legacy user-scoped repository and service paths as transitional
- adds an automated guard so Phase 2 starts from an explicit frozen contract

## Known Transitional State

The repo still contains legacy user-scoped `broker_assets` reads and writes.
Those paths remain temporarily for compatibility and will be removed in Phase 2.

Until Phase 2 lands:

- no new feature should depend on `broker_assets.user_id` for ownership
- no new index or uniqueness rule should be added that strengthens
  user-scoped ownership on `broker_assets`
- all new design work should assume the target model is a global catalog

## Phase 2 Entry Checklist

- audit every `broker_assets` read and write path
- move all writes to global catalog rows
- change user-visible reads to derive assets from `broker_accounts`
- move any user-specific asset preference data outside `broker_assets`
- add the migration that removes `broker_assets.user_id` only after reads and
  writes are fully aligned
