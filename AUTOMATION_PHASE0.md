# Automation Feature — Phase 0 (Product Definition)

Date: 2026-04-02

## 1) Problem Statement
Users want their strategies to run reliably without manual intervention. Today, they must trigger runs manually or rely on ad-hoc scheduler actions, which increases operational risk and missed opportunities. We need a first‑class Automation feature that schedules strategy execution, surfaces run health, and makes failure states actionable.

## 2) Target Users
- **Primary**: Admin/operators who manage automated strategy execution.
- **Secondary**: Power users who want “set and forget” strategy runs with visibility into performance and issues.

## 3) Core Jobs To Be Done
- Schedule a strategy to run on a predictable cadence.
- Pause/resume automation without losing configuration.
- See last/next run time and run health at a glance.
- Diagnose failures quickly with run logs and alerts.

## 4) Automation Types (V1)
Aligned to current domain fields (`strategy`, `broker`, `market`, `trigger`, `riskMode`).
1. **Strategy Automation**: Runs a single strategy definition on a fixed schedule.
2. **Strategy Library Automation**: Runs a strategy-library entry (preferred, as it encapsulates universe/timeframe/overrides).

Out of scope for V1 (explicitly):
- Multi‑strategy portfolios.
- Conditional triggers (signals, external webhooks).
- Event-driven trading (e.g., order book, news).

## 5) Trigger Types (V1)
We will represent trigger in a normalized format and render a user-friendly label.
1. **Interval**: every N minutes/hours (e.g., every 15m, every 1h).
2. **Daily**: once per day at local time.
3. **Weekly**: selected weekdays at local time.

All trigger calculations must respect **user time zone** (not server time).

## 6) Automation Status Model
Match existing API and extend only if necessary:
- `Draft`: defined but not running (no schedule yet).
- `Running`: active and scheduled.
- `Paused`: intentionally stopped; no future runs queued.
- `Failed`: stopped due to repeated errors or fatal configuration issues.

Optional later:
- `Archived`: hidden but retained for audit.

## 7) Run Behavior (V1)
- **No overlap** by default: only one active run per automation at a time.
- **Deduping**: a scheduled run should be idempotent per automation + scheduled time.
- **Missed runs**: if the system is down, catch up only the most recent window (e.g., last 1 run).

## 8) User Experience Requirements
Automation list view should show:
- Name, strategy, broker/market, trigger, status
- Last run + next run
- Health indicator (success rate / last error)

Automation detail view should show:
- Configuration (strategy/library selection, risk mode, accounts)
- Schedule editor
- Run history and alerts

## 9) Success Metrics (V1)
- ≥ 98% scheduled run success rate.
- < 1% duplicate runs per day.
- Median run start delay < 30 seconds from scheduled time.
- 95% of failures have a visible reason in UI within 30 seconds.

## 10) Open Questions (Need Decisions)
1. Should `trigger` store raw schedule JSON or a normalized string (e.g., `interval:15m`)?
2. Should automations be tied to **strategy library entries** only, or allow raw strategies?
3. What is the maximum backlog window for catch‑up runs?
4. Do we need per‑automation concurrency controls beyond “no overlap”?

## 11) Phase 0 Exit Criteria
- Agreed feature scope (types, triggers, status).
- Confirmed UX flow for list + detail views.
- Confirmed scheduling rules (timezone, dedupe, catch‑up).
- Confirmed data model fields to implement in Phase 1.
