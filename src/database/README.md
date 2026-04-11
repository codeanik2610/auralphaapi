# Database Layer

This layer owns persistence only.

## Structure

- `entities/`
- `repositories/`
- `migrations/`

## Ownership Rules

### `entities/`

Allowed:
- TypeORM entity definitions
- persistence mapping metadata

Avoid:
- business orchestration logic
- API request/response concerns

### `repositories/`

Allowed:
- database query logic
- transactional persistence operations
- entity-level read/write helpers

Avoid:
- HTTP concerns
- provider integration calls
- response formatting for controllers

### `migrations/`

Allowed:
- schema changes
- deterministic data backfills needed for schema transitions

Avoid:
- runtime business workflows

## Dependency Direction

Allowed:
- repositories -> entities
- migrations -> schema/data migration concerns

Avoid:
- importing API controllers/services into database code
- importing broker adapters into repositories

## Goal

Keep persistence isolated so schema evolution, query optimization, and business logic can evolve independently.
