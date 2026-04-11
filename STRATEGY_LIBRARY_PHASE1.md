# Strategy Library Phase 1 Contract

This document locks the product semantics for `/strategy-library` before broader UI/UX work.

## Ownership and Permissions

- All `/strategy-library` routes are authenticated and user-scoped.
- Users can only import from templates they own.
- Users can only read, edit, run, change lifecycle, or delete library entries they own.

## Lifecycle Statuses

- `Draft`
  Editable and manually runnable.
  Excluded from scheduled strategy-library signal scans until activated.
- `Active`
  Editable and manually runnable.
  Included in scheduled strategy-library signal scans.
- `Paused`
  Editable and manually runnable.
  Excluded from scheduled strategy-library signal scans.
- `Archived`
  Historical/read-only.
  Excluded from scheduled strategy-library signal scans and blocked from manual runs until restored.

## Allowed Lifecycle Transitions

- `Draft` -> `Active`, `Archived`
- `Active` -> `Paused`, `Archived`
- `Paused` -> `Active`, `Archived`
- `Archived` -> `Draft`, `Active`

Lifecycle changes use `POST /strategy-library/:libraryId/status`.
Content edits stay on `PATCH /strategy-library/:libraryId`.

## Import / Update / Run / Delete Rules

- Import defaults to `Draft` when the UI creates a new entry.
- Import may create `Draft`, `Active`, or `Paused` entries through the API.
- Import cannot create an `Archived` entry directly.
- Import rejects conflicts when the same user already has an entry for the same template with the same trimmed, case-insensitive name.
- Content updates are blocked for `Archived` entries until the entry is restored.
- Content updates cannot rename an entry into the same-template, trimmed, case-insensitive duplicate-name conflict state.
- Delete remains owner-only and is allowed for any lifecycle state.
- Manual runs are allowed for `Draft`, `Active`, and `Paused` entries.
- Manual runs are blocked for `Archived` entries.

## Manual Run Semantics

- `POST /strategy-library/:libraryId/run` queues a one-off backtest snapshot.
- The run response returns only the queue contract: `id`, `backtestId`, `status`, and `message`.
- Request-time assets, timeframes, overrides, start, and end are recorded on the queued backtest only.
- Manual run inputs do not mutate the saved strategy-library entry.
- Saving the form changes future defaults; running the form uses the currently shown values immediately.

## Read Contracts

- `GET /strategy-library/:libraryId` returns the scoped library entry plus `latestRun` only.
- Persistent linked run history is fetched separately via `GET /strategy-library/:libraryId/runs`.
- `GET /strategy-library/:libraryId/runs` accepts `limit` and returns bounded durable history so the UI can refresh runs independently of the entry detail payload.

## Validation Rules

- A queued strategy-library run must resolve to at least one asset.
- A queued strategy-library run must resolve to at least one timeframe.
- `start` and `end` must each be valid date/datetime inputs when provided directly or inherited from saved overrides.
- If both `start` and `end` are provided, `start` must be before or equal to `end`.
