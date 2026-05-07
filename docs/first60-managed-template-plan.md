# First60 Managed 5m Template Plan

## Source Template

Create the new template by duplicating production template `34b6eb3c-6269-4760-9d7c-1f05794073af`, named `Supertrend 10,3 Red-Green Breakout v2`.

Keep its existing entry and exit logic:

- Buy entry: green candle closes above Supertrend(10,3), next red candle is the reference, later green candle closes above that red candle high.
- Buy initial stop: signal candle low.
- Sell entry: red candle closes below Supertrend(10,3), next green candle is the reference, later red candle closes below that green candle low.
- Sell initial stop: signal candle high.

The new template name should be `Supertrend First60 Managed 5m`.

## Template Config Addition

Add this block to the duplicated template config. Keep the duplicated `codeDefinition`, `entryLogic`, `exitLogic`, `entryShortLogic`, `exitShortLogic`, `market`, `risk`, and `parameters` from the source template.

```json
{
  "tradeManagement": {
    "first60": {
      "enabled": true,
      "mode": "post_entry_hold_or_exit",
      "dataSource": "market_candles_1m",
      "windowMinutes": 60,
      "evaluationTimeframe": "1m",
      "buy": {
        "enabled": true,
        "observeOnlyEnabled": true,
        "managementEnabled": false,
        "diagnosticsEnabled": true,
        "decisionGate": {
          "status": "observe_only",
          "reason": "Phase 3c real-data evidence supports BUY observe-only monitoring.",
          "evidenceRef": "storage/first60-evidence/phase3c-summary-2026-05-07.md",
          "decidedAt": "2026-05-07"
        },
        "requiredFavorableR": 1,
        "maxAdverseR": 0.75,
        "targetR": 5,
        "entryBasis": "signal_5m_close",
        "stopBasis": "signal_candle_low",
        "passAction": "hold_for_target",
        "failAction": "paper_tighten_or_exit"
      },
      "sell": {
        "enabled": true,
        "observeOnlyEnabled": false,
        "managementEnabled": false,
        "diagnosticsEnabled": true,
        "decisionGate": {
          "status": "blocked",
          "reason": "Phase 3c real-data evidence showed weak SELL target conversion and negative R.",
          "evidenceRef": "storage/first60-evidence/phase3c-summary-2026-05-07.md",
          "decidedAt": "2026-05-07"
        },
        "requiredFavorableR": 1,
        "maxAdverseR": 0.75,
        "targetR": 4.5,
        "entryBasis": "signal_5m_close",
        "stopBasis": "signal_candle_high",
        "passAction": "hold_for_target",
        "failAction": "paper_tighten_or_exit"
      }
    }
  }
}
```

## Why This Version

The 90-day 1m candle scan covered `2026-02-06 08:01 UTC` through `2026-05-07 08:42 UTC` across the 76-symbol 5m automation universe.

- Buy setup: `first60 favorable >= 1R` and `adverse <= 0.75R`, target `5R`.
- Sell setup: `first60 favorable >= 1R` and `adverse <= 0.75R`, target `4.5R`.
- This increased simulated trade count by about 40 percent versus the stricter `adverse <= 0.5R` rule while improving simulated profit in the historical scan.

## Execution Rule

At signal time, create the suggested trade with the normal entry and stop. After 60 minutes, evaluate 1m candles from entry:

- Pass: favorable movement reaches at least `1R` and adverse movement stays within `0.75R`; keep the side-specific target.
- Fail: do not promote to live. In paper mode, exit, reduce, or tighten according to the execution policy.
- Same-minute conflict handling in backtests stays conservative: stop first.

## Phase Plan

Phase 1: Template contract

- Store `tradeManagement.first60` on the strategy template config.
- Expose the normalized rule through `automationProfile.tradeManagement.first60`.
- Version the template whenever the block changes.

Phase 2: Suggested trade snapshot

- When automation creates a suggested trade, copy the resolved First60 profile into suggested trade metadata.
- Open trades must use their stored snapshot, not whatever the template is changed to later.

Phase 3: Historical simulator

- Run the simulator from the template profile for buy and sell.
- Report trade count, target hit rate, average R, total R, max adverse behavior, and side-level profit.

Phase 3b: Real candle data runner

- Use `scripts/diagnostics/run-first60-template-simulator.ts` to read existing `suggested_trades` from MySQL and `market_candles_1m` from Postgres.
- The runner is read-only. It does not update suggested trades, templates, or candle rows.
- If the source template does not yet have `tradeManagement.first60`, the runner injects the default First60 profile in memory and labels the output as `template+default-first60`.
- Default run window is the last 2 days. Use `FIRST60_LOOKBACK_DAYS=90` or explicit `FIRST60_START` and `FIRST60_END` for a three-month replay.

```bash
node --import tsx scripts/diagnostics/run-first60-template-simulator.ts --dry-run
FIRST60_LOOKBACK_DAYS=2 node --import tsx scripts/diagnostics/run-first60-template-simulator.ts
FIRST60_LOOKBACK_DAYS=90 FIRST60_LIMIT=5000 node --import tsx scripts/diagnostics/run-first60-template-simulator.ts
```

Phase 3d: Side-specific decision gate

- BUY is approved for observe-only monitoring from Phase 3c evidence.
- SELL remains blocked for management because both the 2-day and 90-day real-data runs were negative.
- Keep SELL diagnostics enabled so future rescue sweeps and monitor logs can continue collecting evidence without acting on SELL trades.
- Snapshot the side gate into every suggested trade as `meta.tradeManagementSnapshot.first60.decisionGate`.

Phase 4: Observe-only monitor

- Start First60 evaluation in observe-only mode against BUY paper suggested trades.
- Continue SELL logging as diagnostics only.
- Log pass/fail, favorable R, adverse R, and final outcome.
- Use `scripts/checks/check-first60-observe-only-monitor.ts` after the First60 window closes.
- Default mode is read-only. Set `FIRST60_OBSERVE_WRITE=true` only when ready to persist `meta.first60ObserveOnly` on suggested trades.
- The monitor never places, changes, exits, or cancels paper/live orders.

```bash
node --import tsx scripts/checks/check-first60-observe-only-monitor.ts
FIRST60_OBSERVE_WRITE=true node --import tsx scripts/checks/check-first60-observe-only-monitor.ts
```

Phase 4c: Deploy readiness package

- Use `scripts/checks/check-first60-deploy-readiness.ts` before deploy to verify the profile contract, snapshot markers, monitor evaluator, and package commands.
- Use `docs/first60-deploy-readiness-runbook.md` for deploy and post-deploy verification.
- Post-deploy live readiness can run with `FIRST60_DEPLOY_READINESS_LIVE=true`.
- Do not enable `FIRST60_OBSERVE_WRITE=true` until post-deploy dry-run shows eligible BUY observations.

Phase 5: Paper management

- Apply the fail action only to paper trades.
- Compare hold-all versus First60 managed outcomes for at least 2 trading days.

Phase 6: Live gate

- Enable live only if paper results match historical behavior closely enough.
- Keep live default disabled per template side until explicitly approved.

## Acceptance Gates

- Template API returns the First60 profile for both buy and sell.
- Automation-created suggested trades include the resolved First60 snapshot.
- Paper monitor can explain every pass/fail decision from 1m candles.
- No live action occurs from this rule until the template side has a live gate enabled.
