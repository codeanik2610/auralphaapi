## Positions And Orders Sync Phase 5

Phase 5 standardizes richer scheduler ops truth for `positions-sync` and `orders-sync`.

This phase freezes the additive backend contract that operators depend on before any Phase 6 timezone-localization work:

- Manual queue, stop, and restart commands now stamp explicit `initiatedBy` and `executionContext` audit metadata.
- Run list and run-progress responses now expose additive audit fields plus raw UTC companion fields like `startedAtIso` and `finishedAtIso`.
- Update-log APIs and CSV export now carry inherited scheduler initiator data plus raw UTC `createdAtIso`.
- `positions-sync` purge preview and purge execution now include scheduler-scoped update logs instead of hardcoded zero values.
- Existing display timestamps stay backward compatible for now; Phase 6 should localize them against this additive audit contract instead of redesigning the payload again.

Phase 6 should implement localized display timestamps and consistent user-timezone rendering on top of this stable audit/ops payload.
