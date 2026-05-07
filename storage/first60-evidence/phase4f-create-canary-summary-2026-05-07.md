# Phase 4f - First60 suggestion-only canary

Date: 2026-05-07

## Outcome

Phase 4f is complete. A new First60 canary template and a paused suggestion-only canary automation now exist on the droplet.

## Canary template

- Source template: `34b6eb3c-6269-4760-9d7c-1f05794073af` (`Supertrend 10,3 Red-Green Breakout v2`)
- Canary template: `f7d16c3d-12f8-4f64-b52a-2cf8fa48835b`
- Name: `Phase 4f First60 Suggestion-Only Canary - Supertrend 5m`
- Status: `Draft`
- Template version: `2`
- Persisted `tradeManagement.first60`: yes

## First60 gate

- BUY: `observe_only`
- BUY observe-only enabled: yes
- BUY management enabled: no
- SELL: `blocked`
- SELL observe-only enabled: no
- SELL management enabled: no
- SELL diagnostics enabled: yes

## Canary automation

- Automation: `60905546-9a5d-43dd-86f0-74ee3fe075fd`
- Name: `Phase 4f First60 suggestion-only canary - 5m - 3 assets`
- Type: `trade-suggestion`
- Status: `Paused`
- Trigger: `manual`
- Schedule: none
- Next run: none
- Execution mode: `suggestion_only`
- Approval mode: `manual_review`
- Live consent: disabled
- Scope: `BSBUSDT`, `MERLUSDT`, `LDOUSDT` on `5m`

## Safety verification

- Database normalizer now preserves `tradeManagement`.
- Persisted template has `tradeManagement.first60`.
- Canary automation has zero automation runs.
- Canary automation has zero suggested trades.
- Existing paused `live_trade_auto` automations were not resumed or triggered.
- No live order path was enabled.

## Local source change

- Added migration: `src/database/pg-migrations_baseline/1800000100000-PreserveStrategyTemplateTradeManagement.ts`

## Next step

Phase 4g should manually trigger the paused suggestion-only canary once, then rerun Phase 4d evidence capture against the newly generated suggested trade.
