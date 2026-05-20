# Mudrex Guardrail Phase Plan

## Goal

Bring Mudrex to production-grade guardrail coverage without changing live trading behavior until each read-only phase proves clean.

Mudrex currently has strong position identity coverage through the position-resolution watchdog. The missing work is mostly protection-health coverage: missing SL/TP, wrong protection size, stale protection after close, and scheduled preview artifacts.

## Current Coverage

- [x] Scheduled position-resolution watchdog.
- [x] Detects unsafe live/read-model position mismatch.
- [x] Detects unresolved preferred position.
- [x] Checks direct raw payload mapping.
- [x] Checks strict open-time fallback mapping.
- [x] Writes artifacts every 30 minutes.
- [x] Read-only, no mutation path.

## Missing Coverage

- [x] Missing active stop-loss detection.
- [x] Missing active take-profit detection.
- [x] Partial-fill protection quantity mismatch detection.
- [x] Stale protection after terminal/closed position detection.
- [x] Stale protection cancellation preview.
- [x] Mutation apply path guarded by read-back and disabled by default.
- [x] Scheduled protection-health watchdog artifacts.

## Phase 1: Protection Health Read-Only Audit

Build a Mudrex protection-health check that audits recent suggested trade executions and live/read-model order snapshots.

Coverage:

- [x] Filled/open Mudrex trades have active SL protection when required.
- [x] Filled/open Mudrex trades have active TP protection when required.
- [x] Terminal/closed Mudrex trades do not still require active protection.
- [x] Protection quantity matches resolved live position quantity.
- [x] Report blockers instead of mutating anything.

Acceptance:

- [x] Produces JSON with audited count, open positions, issue counts, and item details.
- [x] Has thresholds defaulting to zero.
- [x] Fails only when issue counts exceed thresholds.
- [x] No broker mutation code is reachable.

## Phase 2: Scheduled Mudrex Protection Watchdog

Wrap Phase 1 in a Docker runner and cron entry.

Coverage:

- [x] Runs every 30 minutes.
- [x] Writes JSON and log artifacts.
- [x] Retains artifacts for a bounded window.
- [x] Keeps apply flags absent or false.

Acceptance:

- [x] Cron installed under `/etc/cron.d`.
- [x] Latest artifact proves scheduled execution.
- [x] Cron failure is visible in log/artifact path.

## Phase 3: Protection Repair Preview

Create a preview report that classifies each Mudrex protection issue into an intended action.

Actions:

- [x] `would_attach_missing_protection`
- [x] `would_replace_mismatched_partial_fill_protection`
- [x] `would_mark_terminal_protection_not_required`
- [x] `would_cancel_stale_protection_orders`
- [x] `manual_review_required`

Acceptance:

- [x] Preview contains expected mutation details but performs no mutation.
- [x] Preview blocks unsafe position mismatch and unresolved position identity.
- [x] Preview includes exact account, symbol, side, position id, order ids, and size basis.

## Phase 4: Apply Path, Disabled By Default

Add the repair apply script with explicit environment gates.

Required gates:

- [x] Broker repair flag enabled.
- [x] Mudrex repair apply flag enabled.
- [x] Stale cancel apply flag separately enabled.
- [x] Candidate limit configured.

Safety rules:

- [x] Fresh live position read-back before attach or replace.
- [x] Fresh live order read-back before cancel.
- [x] Never cancel entry orders.
- [x] Never mutate if same-symbol ambiguity exists.
- [x] Never mutate if position identity is unresolved.

Acceptance:

- [x] Dry-run is default.
- [x] Apply mode reports skipped/blocked/applied/error items.
- [x] Stale cancellation requires both general apply and stale-cancel apply flags.

## Phase 5: Production Preview Verification

Deploy Phases 1-4, keep all apply flags off, and run production preview.

Acceptance:

- [ ] `dryRun: true`
- [ ] `applyEnabled: false`
- [ ] `staleCancelApplyEnabled: false`
- [ ] Issue counts reviewed.
- [ ] No mutation executed.

## Phase 6: Canary Apply

Only if production preview finds a safe candidate.

Rules:

- [ ] Apply one candidate only.
- [ ] Capture before and after artifact.
- [ ] Confirm broker state with live read-back.
- [ ] Confirm database execution state updated correctly.
- [ ] Stop after one candidate for review.

## Phase 7: Scheduled Apply Watchdog, Still Disabled

Keep scheduled watchdog read-only, but make its artifacts compatible with the apply script.

Acceptance:

- [ ] Watchdog shows exactly which items would be eligible for apply.
- [ ] Watchdog fails loudly if apply flags are accidentally enabled in the cron environment.

## Phase 8: Operator Runbook

Document how to inspect, preview, and apply a single repair.

Acceptance:

- [ ] Includes artifact paths.
- [ ] Includes required environment flags.
- [ ] Includes rollback/manual broker verification steps.
- [ ] Includes "do not proceed" conditions.
