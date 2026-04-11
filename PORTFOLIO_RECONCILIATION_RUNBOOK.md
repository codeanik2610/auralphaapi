# Portfolio Reconciliation Runbook

Date: 2026-04-10

## Purpose
Use this runbook when `/portfolio` shows drift between stored posture, visible capital routes, or closed-position activity and an operator needs to decide whether to rebalance, hold, or escalate.

## Source Model
- Stored posture:
  `portfolio_snapshots`
- Holdings workspace:
  the loaded overview slice from the latest snapshot
- Capital routes:
  wallet and futures funds snapshots per connected account
- Activity:
  realized closed-position history from scheduler snapshots

The page is intentionally manual.
It does not auto-reconcile broker balances back into stored portfolio snapshots.

## When To Run It
- the largest holding concentration breaches the portfolio review threshold
- any holding is marked `Watch` or `At risk`
- wallet versus futures visible capital drifts materially
- realized activity is negative for the selected timeframe
- freshness or trust banners indicate stale or partial data
- an operator is preparing a rebalance or capital-allocation decision

## Operator Steps
1. Refresh `/portfolio` and confirm the `Contract & trust` section is current enough to act on.
2. Check the freshness and availability rows for `Book posture`, `Holdings workspace`, `Capital routes`, and `Closed-position activity`.
3. Set the portfolio timeframe, holdings focus, search term, and selected holding that match the review scope.
4. Generate a rebalance review from the current workspace state.
5. Read the review highlights first, then the recommended actions, and confirm whether the trigger is concentration, risk-state drift, capital-route imbalance, or realized activity weakness.
6. If a holding is selected, inspect its stored posture before changing allocation.
7. Generate a workspace report and attach or share it before handing the decision to another operator.

## Escalation Rules
- If any section is `missing` or `critical`, do not act on the page alone. Refresh again and escalate to the data owner if the issue persists.
- If capital-route snapshots are missing or obviously stale, treat wallet/futures guidance as incomplete.
- If the selected holding is not present in the loaded slice, widen the workspace view before making a decision.
- If the review suggests concentration trimming but capital routes are stale, verify available capital outside the page before reallocation.

## Decision Notes
- Use the review/report output as an operator decision aid, not as an execution authorization.
- The workspace report is the record of the reviewed state at that moment in time.
- If a rebalance proceeds elsewhere, refresh `/portfolio` again after execution to confirm the new posture.
