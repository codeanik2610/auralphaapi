# Phase 3c First60 Real-Data Evidence

Generated on 2026-05-07 from the production droplet API container.

The run was read-only. It queried MySQL `suggested_trades` and Postgres
`market_candles_1m`, then simulated the First60 rule in memory. The production
template did not yet include an enabled `tradeManagement.first60` profile, so
the default First60 plan was injected in memory only.

## Inputs

- Template: `34b6eb3c-6269-4760-9d7c-1f05794073af`
- Source backtest: `9faa221e-a30e-4d2b-89cb-a7c0a99b89be`
- Timeframe: `5m`
- First60 BUY: favorable `>= 1R`, adverse `<= 0.75R`, target `5R`
- First60 SELL: favorable `>= 1R`, adverse `<= 0.75R`, target `4.5R`
- Max hold after signal: `1440m`

## 2-Day Evidence

Artifact: `storage/first60-evidence/first60-realdata-2d-2026-05-07.json`

Loaded `579` signals across `75` symbols and `185523` 1m candles.

| Side | Trades | Pass rate | Target rate | Target after pass | Total R | Avg R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BUY | 272 | 35.29% | 11.76% | 33.33% | 140.88R | 0.52R |
| SELL | 307 | 24.76% | 1.95% | 7.89% | -54.84R | -0.18R |

Best BUY symbols: `TLMUSDT`, `SUSHIUSDT`, `PIEVERSEUSDT`.
Worst BUY symbols: `ZKCUSDT`, `PUMPBTCUSDT`, `INITUSDT`.

Best SELL symbols: `CROSSUSDT`, `TURTLEUSDT`, `BSBUSDT`.
Worst SELL symbols: `CGPTUSDT`, `METUSDT`, `MASKUSDT`.

## 90-Day Evidence

Artifact: `storage/first60-evidence/first60-realdata-90d-2026-05-07.json`

Loaded `1339` signals across `75` symbols and `510389` 1m candles.

| Side | Trades | Pass rate | Target rate | Target after pass | Total R | Avg R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BUY | 662 | 33.38% | 10.73% | 32.13% | 235.41R | 0.36R |
| SELL | 677 | 22.90% | 2.36% | 10.32% | -108.91R | -0.16R |

Best BUY symbols: `PIEVERSEUSDT`, `SUSHIUSDT`, `TURTLEUSDT`.
Worst BUY symbols: `TRUMPUSDT`, `METUSDT`, `CETUSUSDT`.

Best SELL symbols: `PIEVERSEUSDT`, `WAXPUSDT`, `LUMIAUSDT`.
Worst SELL symbols: `TNSRUSDT`, `SUSHIUSDT`, `TRXUSDT`.

## Read

On this real suggested-trade sample, the current First60 rule is acceptable for
BUY but not for SELL. SELL needs a separate rule/tighter filter before moving
to observe-only management.

## Phase 3d Decision Gate

- BUY: `status=observe_only`, `observeOnlyEnabled=true`, `managementEnabled=false`, `diagnosticsEnabled=true`.
- SELL: `status=blocked`, `observeOnlyEnabled=false`, `managementEnabled=false`, `diagnosticsEnabled=true`.

This means Phase 4 should monitor BUY in observe-only mode. SELL should continue
to be logged for diagnostics, but no First60 management action should be taken
for SELL trades with the current setup.
