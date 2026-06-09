# Broker Reconciliation Phase 1 Audit

Date: 2026-06-09
Scope: Mudrex and Delta Exchange only
Mode: Read-only audit of local code and production storage

## Goal

Identify what broker data the app already syncs and stores, and what is missing before we can reconcile app PnL against broker dashboard PnL.

## Current Local Code Coverage

### Mudrex

Existing services:

- `src/brokers/providers/mudrex/WalletService.ts`
  - `/fapi/v1/wallet/funds`
  - `/fapi/v1/futures/funds`
- `src/brokers/providers/mudrex/OrdersService.ts`
  - `/fapi/v1/futures/orders`
  - `/fapi/v1/futures/orders/history`
  - `/fapi/v1/futures/orders/{orderId}`
  - create/cancel futures order endpoints
- `src/brokers/providers/mudrex/PositionsService.ts`
  - `/fapi/v1/futures/positions`
  - `/fapi/v1/futures/positions/history`
  - liquidation price, margin update, risk order, close, partial close, reverse

Missing Mudrex service coverage:

- `/fapi/v1/futures/fee/history`
- A normalized funding/fee ledger sync
- A per-trade net PnL reconciliation path

### Delta Exchange

Existing services/adapters:

- `src/brokers/capabilities/wallet/DeltaExchangeWalletAdapter.ts`
  - `/v2/wallet/balances`
- `src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts`
  - `/v2/orders`
  - `/v2/orders/history`
- `src/brokers/capabilities/positions/DeltaExchangePositionsAdapter.ts`
  - `/v2/positions/margined`
  - `/v2/fills` for fill-based closed-position reconstruction

Current Delta closed-position payloads can carry `commission` from fills, but this is only kept in raw position payload JSON and is not normalized into a reconciliation table.

Missing Delta service coverage:

- `/v2/wallet/transactions`
- Normalized fills table
- Normalized commission/funding ledger
- Per-trade net PnL reconciliation path

## Current Production Storage

Production host inspected: `168.144.66.167`

Existing relevant tables:

- `funds_snapshots`
- `scheduler_orders_snapshots`
- `scheduler_positions_snapshots`
- `position_read_models`
- `risk_account_snapshots`
- `risk_order_snapshots`
- `risk_position_snapshots`
- `order_submission_requests`
- `suggested_trade_executions`

No existing normalized tables were found for:

- broker fills
- broker fee entries
- broker funding entries
- broker wallet transactions
- broker reconciliation runs

## Production Row Coverage

Snapshot from the Phase 1 audit:

| Area                                 |                                 Mudrex |                                        Delta Exchange |
| ------------------------------------ | -------------------------------------: | ----------------------------------------------------: |
| connected broker accounts            |                                      2 |                                                     2 |
| `funds_snapshots` rows               |     52, latest 2026-06-09 08:30:03 UTC |                    52, latest 2026-06-09 08:30:03 UTC |
| `scheduler_orders_snapshots` rows    |     60, latest 2026-06-09 08:30:07 UTC |                   375, latest 2026-06-09 08:00:23 UTC |
| `scheduler_positions_snapshots` rows |  1,897, latest 2026-06-09 08:30:17 UTC |                   467, latest 2026-05-29 00:10:07 UTC |
| `position_read_models` rows          |  1,897, latest 2026-06-09 08:30:18 UTC |                   467, latest 2026-05-29 00:10:07 UTC |
| `order_submission_requests` rows     |    375, latest 2026-06-09 05:51:16 UTC |                   125, latest 2026-05-07 11:36:58 UTC |
| `suggested_trade_executions` rows    |    135, latest 2026-06-09 08:29:06 UTC | No current execution rows returned in the audit query |
| `risk_account_snapshots` rows        | 40,201, latest 2026-06-09 08:29:04 UTC |                40,201, latest 2026-06-09 08:29:04 UTC |
| `risk_position_snapshots` rows       | 62,000, latest 2026-06-09 08:12:04 UTC |                32,203, latest 2026-05-28 10:18:03 UTC |

## Stored Fields Today

### Funds

`funds_snapshots` stores:

- broker key
- account id
- wallet funds JSON
- futures funds JSON
- computed/observed time
- fetch status and error

It does not store:

- transaction ledger rows
- fee rows
- funding rows
- deposits/withdrawals/transfers as separate events

### Orders

`scheduler_orders_snapshots` stores:

- broker order id as `external_id`
- symbol
- broker order status
- status rank
- raw payload JSON
- first/last seen timestamps

Mudrex payloads include fields like:

- `id`
- `symbol`
- `order_type`
- `trigger_type`
- `leverage`
- `quantity`
- `filled_quantity`
- `filled_price`
- `actual_amount`
- `future_position_uuid`

Delta payloads include fields like:

- `id`
- `symbol`
- `side`
- `size`
- `order_type`
- `limit_price`
- `average_fill_price`
- `filled_quantity`
- `actual_amount`
- `client_order_id`

The table does not normalize fees, commission, funding, or wallet impact.

### Positions

`scheduler_positions_snapshots` stores:

- broker position/history id as `external_id`
- symbol
- broker status
- status rank
- raw payload JSON
- first/last seen timestamps

`position_read_models` normalizes:

- symbol
- side
- status
- quantity
- entry/current/closed price
- unrealized PnL
- realized PnL
- leverage
- liquidation price
- exposure
- stop loss and take profit fields
- opened/updated/closed timestamps

It does not normalize:

- trading fees
- funding
- broker net PnL
- balance before/after
- fee match confidence
- ledger transaction ids

### Delta Commission

Delta closed-position reconstruction from `/v2/fills` can carry `commission` in the raw position payload. Production has Delta position payloads with the word `commission`, but there is no normalized commission column or table yet.

### Mudrex Fees

Mudrex order and position payloads currently stored in production do not provide enough normalized fee/funding data to explain Mudrex dashboard PnL. The Mudrex fee-history endpoint is not wired into the app yet.

## Phase 1 Conclusion

The current system is good enough for:

- live order status
- position status
- gross realized PnL
- unrealized PnL
- risk exposure
- balance snapshots
- automation execution tracking

The current system is not enough for:

- exact broker dashboard PnL reconciliation
- per-trade net PnL after fees
- funding fee attribution
- balance movement explanation
- Mudrex 24h PnL matching
- Delta wallet-ledger matching

## Required Next Phase

Phase 2 should add read-only reconciliation storage:

- `broker_fills`
- `broker_fee_entries`
- `broker_funding_entries`
- `broker_wallet_transactions`
- `broker_balance_snapshots`
- `broker_reconciliation_runs`

No trading behavior should change in Phase 2. It should only create the storage layer needed for Mudrex and Delta reconciliation.
