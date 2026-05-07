# Phase 4h - Historical-signal canary

Date: 2026-05-07

## Outcome

Phase 4h is complete. A cursor-gap historical-signal canary pass generated one new suggestion and validated that the First60 snapshot is attached to the suggested trade.

## Target signal

- Symbol: `MERLUSDT`
- Timeframe: `5m`
- Side: `BUY`
- Signal time: `2026-05-07T12:40:00.000Z`
- Cursor seed: `2026-05-07T12:35:00.000Z`
- Evaluation time: `2026-05-07T12:45:01.000Z`

## Canary run

- Automation: `60905546-9a5d-43dd-86f0-74ee3fe075fd`
- Template: `f7d16c3d-12f8-4f64-b52a-2cf8fa48835b`
- Run: `f2057105-41f6-48fb-bb5a-ea80db83ac29`
- Trigger: `manual-historical-signal-canary`
- Signals detected: `1`
- Suggested trades inserted: `1`
- Duplicates: `0`
- Created trade: `0304599b-f7a8-4cf5-81e9-086477342ef2`

## Snapshot validation

- First60 snapshot present: yes
- Gate status: `observe_only`
- Management enabled: no
- Required favorable R: `1`
- Max adverse R: `0.75`
- Target R: `5`

## Phase 4d rerun

- Post-trigger suggested trades: `1`
- First60 snapshots: `1`
- First60 gate snapshots: `1`
- Observe-only gate snapshots: `1`
- Observe results written: `0`

## Observe-only dry-run

- Candidates: `1`
- Evaluated: `1`
- Write-eligible: `1`
- Written: `0`
- Outcome: `first60_failed`
- Favorable R: `0.6428`
- Adverse R: `0.3061`
- Follow-through exit: stop at `2026-05-07T14:17:00.000Z`

## Safety

- Automation status after run: `Paused`
- Next run after run: none
- Execution mode: `suggestion_only`
- Approval mode: `manual_review`
- Live consent: disabled
- Auto-paper placed: `0`
- Auto-live placed: `0`
- Order submissions created: `0`
- Paper orders created: `0`
- Cursor restored after the targeted pass: yes

## Conclusion

The template-level First60 snapshot path is working for a real generated suggestion. The observe-only monitor can evaluate the trade in dry-run mode, but no `first60ObserveOnly` result was written because this phase kept the monitor in dry-run mode.
