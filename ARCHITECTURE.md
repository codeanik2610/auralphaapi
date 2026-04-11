# Backend Architecture

## Layer Ownership

- `src/api`: HTTP and application orchestration
- `src/brokers`: external broker integration runtime
- `src/database`: persistence (entities, repositories, migrations)
- `src/loaders`: bootstrap and initialization
- `src/lib`: shared low-level infrastructure

## API Layer (`src/api`)

Folders:
- `controllers/`
- `contracts/`
- `validators/`
- `middlewares/`
- `errors/`
- `services/`
- `utils/`
- `strategies/`

Rules:
- controllers parse/validate and delegate only
- services orchestrate use-cases and facades
- provider transport code does **not** live in `api/services`

Barrels:
- `src/api/index.ts`
- `src/api/contracts/index.ts`
- `src/api/errors/index.ts`
- `src/api/utils/index.ts`

## Brokers Layer (`src/brokers`)

Folders:
- `core/`
- `providers/`
- `capabilities/`

### Core (`src/brokers/core`)

Contains:
- routing
- registries
- broker definition resolution
- startup validation
- diagnostics dispatch
- shared runtime types

### Providers (`src/brokers/providers`)

Provider-owned implementation details:
- `providers/binance/`
- `providers/delta_exchange/`
- `providers/mudrex/`

Contains:
- broker modules
- HTTP clients
- provider services/helpers
- provider error mapping/signing/parsing helpers

### Capabilities (`src/brokers/capabilities`)

Cross-provider capability adapters/executors:
- `orders/`
- `positions/`
- `wallet/`
- `market/`
- `diagnostics/`
- `sync/`

Rules:
- adapters/executors stay in capability folders
- capability code may depend on provider clients/services
- provider folders must not import capability adapters

Barrels:
- `src/brokers/index.ts`
- `src/brokers/core/index.ts`
- `src/brokers/providers/index.ts`
- `src/brokers/providers/*/index.ts`
- `src/brokers/capabilities/index.ts`
- `src/brokers/capabilities/*/index.ts`

## Database Layer (`src/database`)

Folders:
- `entities/`
- `repositories/`
- `migrations/`

Rules:
- repositories own DB querying and persistence
- controllers never access repositories directly
- migrations handle schema/data transition only

Barrels:
- `src/database/index.ts`
- `src/database/entities/index.ts`
- `src/database/repositories/index.ts`

## Dependency Direction

Allowed:
- `api -> brokers, database, lib`
- `brokers/core -> brokers/providers, brokers/capabilities`
- `brokers/capabilities -> brokers/providers, api, database, lib`
- `brokers/providers -> api, database, lib, brokers/core/types`
- `database/repositories -> database/entities`

Avoid:
- `database -> api`
- `brokers -> api/controllers`
- `providers -> capabilities`

## Import Conventions

Use barrel imports where available:
- `from '../../brokers'`
- `from '../../database'`
- `from '../../api'`

Avoid deep file-path imports when a barrel exists.

## Practical Rule for New Code

1. Add/modify endpoint in `api/controllers`
2. Keep orchestration in `api/services`
3. Put provider runtime/client logic in `brokers/providers/*`
4. Put cross-provider execution adapters in `brokers/capabilities/*`
5. Keep all persistence access in `database/repositories`
