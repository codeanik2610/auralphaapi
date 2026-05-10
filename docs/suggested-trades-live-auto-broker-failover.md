# Suggested Trades Live-Auto Broker Failover

## Phase 1 Contract

Live-auto suggested trades must use a broker attempt chain instead of a single selected broker. Adaptive routing can still rank the candidates, but execution must keep trying eligible broker/account routes until one creates an order or every route has been rejected.

This contract does not change live-auto order limits. Keep the existing limits intact:

- `maxConcurrentOpenTrades = 100`
- `maxOrdersPerRun = 100`
- `maxOrdersPerDay = 100`

## Current Problem

The current live-auto path ranks adaptive broker candidates, selects the best viable candidate, and submits one order. If that broker rejects the order, the suggested trade is marked failed even when another broker candidate was viable.

Example failure mode:

1. Delta and Mudrex both pass candidate checks.
2. Delta ranks first.
3. Delta rejects the order due to insufficient margin.
4. The trade is marked failed.
5. Mudrex is never attempted.

## Target Behavior

For each live-auto suggested trade:

1. Build all eligible broker/account candidates.
2. Rank candidates with the existing adaptive route comparator.
3. Attempt the first ranked route.
4. If the attempt fails before confirmed order creation, record the failure and attempt the next route.
5. Continue until one route creates an order or all eligible routes fail.
6. Stop immediately after the first confirmed order creation.
7. Mark the suggested trade as failed only after all eligible routes have failed.

The final execution state must explain the whole chain, not only the last failure.

## Failure Handling

Confirmed no-order failures should move immediately to the next route. Examples:

- insufficient margin
- invalid symbol or stale product mapping
- broker rejected price, quantity, tick, or step
- broker unavailable for the symbol
- pre-trade check blocked after route-specific evaluation
- protection preflight rejection before order creation
- adapter validation error before broker submission

Ambiguous failures must be reconciled before trying the next route. Examples:

- timeout after broker submission
- network disconnect
- broker 5xx after request was sent
- response shape missing order id
- unknown adapter exception after submission began

For ambiguous failures, the system must check broker state by idempotency key, suggested trade id, broker symbol, recent order window, and position snapshot where supported. If reconciliation confirms no order or position exists, the next route can be attempted. If reconciliation cannot prove that, stop failover and mark the trade for manual review to avoid duplicate exposure.

## Protection Handling

Failover is allowed only until confirmed order creation. After an order is created, broker protection behavior must follow the existing protection path:

- Native SL/TP attached: mark route successful.
- Native SL/TP not attached but post-fill protection is allowed: mark route successful and continue protection repair.
- Order created but protection is unsafe, stale, or unconfirmed: do not open another broker route for the same signal. Mark the protection state for repair or manual action.

## Attempt Metadata

Each route attempt must be persisted in execution metadata so the UI and production debugging can show exactly what happened.

Phase 2 stores this chain in `suggested_trade_executions.route_attempts_json` and exposes it as `execution.routeAttempts`.

Required fields for each attempt:

- attempt number
- broker key
- account id
- account name when available
- requested symbol
- broker symbol
- candidate rank
- started at
- finished at
- pre-trade check id
- pre-trade state
- submission state
- order id when created
- failure code
- failure message
- reconciliation result for ambiguous failures

The successful route should also remain available in the existing top-level execution fields:

- `brokerKey`
- `accountId`
- `orderId`
- `orderStatus`
- `executionState`
- `protectionState`

## Safety Invariants

- Never create more than one confirmed live order for the same suggested trade.
- Never continue to another broker after confirmed order creation.
- Never retry a broker/account route already attempted for the same suggested trade execution.
- Never bypass pre-trade checks for fallback routes.
- Preserve existing duplicate asset and concurrent exposure checks.
- Preserve existing daily, per-run, and concurrent order limits.
- Every failed route must be visible in logs and execution metadata.
- A final failure must say all routes failed and include each route reason.

## Implementation Boundary For Later Phases

Phase 2 should add the metadata shape and type contract.

Phase 3 should refactor the current single-route submit path into a reusable route attempt function and an outer broker failover loop.

Phase 4 should add reconciliation before fallback for ambiguous broker responses.

Phase 4 implementation reconciles ambiguous submit failures before route fallback. If broker reads find
a matching order, the execution is linked to that order and failover stops. If broker reads find a
matching position, the execution is marked filled with protection repair still pending and failover
stops. Only when both order and position reconciliation complete with no match does failover continue
to the next broker.

Phase 5 should keep protection repair separate from broker fallback after order creation.

Phase 5 implementation makes confirmed-order protection gaps explicit without triggering broker
fallback. When an order is created but SL/TP is provisional, missing, failed, or needs manual
action, the successful route remains placed and the execution keeps the broker order/position link.
The protection state and route attempt carry `order_created_protection_unresolved` so repair/manual
work is visible without opening a second broker position.

Phase 6 exposes the operator timeline for UI consumers. Suggested trade details include
`timeline` events with `broker_route` and `protection` kinds. Position lifecycle responses include
`relatedSuggestedTrades[].routeAttempts` plus `relatedSuggestedTrades[].operatorTimeline` so the
position popup can render exact broker route, fill, protection check, repair, attach, and close
timestamps without inferring sequence from five-minute candles.

Phase 7 hardens the test contract. The `test:positions` script must run the full positions suite
when no step is supplied, and direct step runs such as `scripts/test-positions.ts 05` must still work.
The positions lifecycle guard verifies the popup data contract, while the read-model guard verifies
that persisted `route_attempts_json` is carried into `automationTrade.routeAttempts` and
`automationTrade.operatorTimeline`.
