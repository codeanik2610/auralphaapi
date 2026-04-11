# Alerts and Activity Taxonomy

This project uses two operational streams:

- `Activity`: audit trail of user/system actions.
- `Alerts`: operational incidents that require attention.

## Activity fields

- `type`: functional domain (`Connection`, `Broker account`, `Scheduler`, `Signal`, `Order`, `Position`, `Risk control`, `Strategy lab`, `Backtest`, etc.).
- `title`: short human-readable action summary.
- `status`: `Success`, `Warning`, or `Failed`.
- `route`: UI page or module where action belongs (`Brokers data`, `Schedulers`, `Signals`, `Risk`, ...).
- `stream`: lane inside route (`Controls`, `Sync`, `Execution`, `Validation`, `Runs`, ...).
- `related`: optional secondary key (broker key, scheduler source, target route, symbol source).
- `referenceId`: optional entity id for drilldown.
- `description`: optional details/error message.

## Alert fields

- `channel`: incident domain (`Scheduler`, `Brokers`, `Trading`, `Signals`, `Risk`, `Strategy`, ...).
- `source`: low-cardinality producer key (`connections`, `broker_accounts`, `kill_switch`, `strategy_lab`, ...).
- `message`: short failure summary.
- `route`: primary triage destination (`Risk review`, `Alerts`, `Schedulers`, ...).
- `severity`: default `High` for failures unless explicitly lower/higher.
- `status`: use `Open` for active incident.
- `urgency`: default `Immediate`.

## Rules

- Every mutating endpoint should emit `Activity` on success.
- Every mutating endpoint failure should emit:
  - `Activity` with `status: Failed`
  - `Alert` (throttled by `userId + channel + source` window and deduped by open-message)
- Event emission must be non-blocking: primary operation result should not fail because activity/alert persistence failed.
- Read-only endpoints should not emit activity by default.

## Ownership map

- `OperationalEventService`: centralized helper for non-blocking activity/alert emission and alert dedupe checks.
- Feature services: define domain-specific `type`, `route`, `stream`, `channel`, and `source` values.
