# Brokers Layer

This folder is split by ownership and execution concern.

## Structure

- `core/`
- `providers/`
- `capabilities/`

## `core/`

Contains broker runtime orchestration only.

Examples:
- registry
- routing
- broker definition resolution
- diagnostics dispatch
- startup validation
- shared broker runtime types

Do not place provider HTTP clients or capability adapter implementations here.

## `providers/`

Contains provider-owned implementation details.

Current providers:
- `providers/mudrex/`
- `providers/delta_exchange/`
- `providers/binance/`

Allowed content:
- broker module/manifest wiring
- provider HTTP client
- provider auth/signing helpers
- provider-specific transport parsing helpers

Do not place generic capability registry logic here.

## `capabilities/`

Contains capability adapters/executors by domain.

Current capability folders:
- `capabilities/orders/`
- `capabilities/positions/`
- `capabilities/wallet/`
- `capabilities/market/`
- `capabilities/diagnostics/`
- `capabilities/sync/`

Rules:
- keep adapter contracts and capability types here
- adapters may depend on provider clients under `providers/*`
- avoid embedding unrelated app/business orchestration logic

## Dependency Direction

Allowed:
- `core` -> `providers`, `capabilities`
- `capabilities` -> `providers`, `api`, `database`, `lib`
- `providers` -> `api`, `database`, `lib`, `core/types`

Avoid:
- `providers` importing capability adapters
- cyclic imports between `providers` and `capabilities`

## Goal

Keep `api` focused on request/response handling, keep `database` focused on persistence, and keep all external broker integration behavior inside this `brokers` layer.
