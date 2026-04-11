# API Layer

This layer owns request/response handling and application orchestration.

## Structure

- `controllers/`
- `contracts/`
- `validators/`
- `middlewares/`
- `errors/`
- `services/`
- `utils/`
- `strategies/`

## Ownership Rules

### `controllers/`

Allowed:
- read path/query/body params
- call validators
- call services
- return API response contracts

Avoid:
- direct repository access
- broker adapter wiring
- low-level provider HTTP calls

### `contracts/`

Allowed:
- API request/response shapes
- DTO typing for controller/service boundaries

Avoid:
- business logic
- persistence concerns

### `validators/`

Allowed:
- request validation and normalization
- typed validated payload output

Avoid:
- repository calls
- external API calls

### `services/`

Allowed:
- application use-case orchestration
- cross-module coordination
- facade-level broker routing

Current expectation:
- keep `api/services` provider-agnostic
- provider transport/client logic belongs in `brokers/providers/*`
- capability adapter logic belongs in `brokers/capabilities/*`

Avoid:
- owning provider HTTP transport implementations
- embedding provider signing/parsing logic

### `middlewares/`

Allowed:
- authentication/authorization checks
- request guard concerns

Avoid:
- business use-case logic

## Dependency Direction

Allowed:
- `controllers` -> `validators`, `services`, `contracts`
- `services` -> `database`, `brokers`, `utils`, `errors`
- `validators` -> `errors`, `contracts`

Avoid:
- `database` importing `api`
- `brokers` importing `controllers`

## Goal

Keep API code thin and predictable: parse, validate, orchestrate, respond.
