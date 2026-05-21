# Mudrex Guardrail Phase Plan

## Goal

Bring Mudrex to production-grade guardrail coverage without changing live trading behavior until each read-only phase proves clean.

Mudrex currently has strong position identity coverage through the position-resolution watchdog and production-verified protection-health coverage. The remaining work is staged canary apply only when a real safe candidate appears, followed by a scheduled-apply decision.

## Current Coverage

- [x] Scheduled position-resolution watchdog.
- [x] Detects unsafe live/read-model position mismatch.
- [x] Detects unresolved preferred position.
- [x] Checks direct raw payload mapping.
- [x] Checks strict open-time fallback mapping.
- [x] Writes artifacts every 30 minutes.
- [x] Read-only, no mutation path.
- [x] Scheduled protection-health watchdog artifacts.
- [x] Production repair preview baseline with apply flags disabled.
- [x] Scheduled stale-protection watchdog source, runner, and cron definition.

## Missing Coverage

- [x] Missing active stop-loss detection.
- [x] Missing active take-profit detection.
- [x] Partial-fill protection quantity mismatch detection.
- [x] Stale protection after terminal/closed position detection.
- [x] Stale protection cancellation preview.
- [x] Mutation apply path guarded by read-back and disabled by default.
- [x] Scheduled protection-health watchdog artifacts.
- [x] Scheduled stale-protection watchdog artifacts path and zero-mutation flag checks.
- [ ] Single-candidate production canary apply when a real safe candidate appears.
- [ ] Scheduled apply decision after canary evidence.

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

- [x] `dryRun: true`. Verified in `/opt/auralpha/guardrail-artifacts/mudrex-protection-repair-preview/20260521T044501Z-preview.json`.
- [x] `applyEnabled: false`. Verified in `/opt/auralpha/guardrail-artifacts/mudrex-protection-repair-preview/20260521T044501Z-dry-run.json`.
- [x] `staleCancelApplyEnabled: false`. Verified in `/opt/auralpha/guardrail-artifacts/mudrex-protection-repair-preview/20260521T044501Z-dry-run.json`.
- [x] Issue counts reviewed. Baseline found zero repairable items.
- [x] No mutation executed.

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

- [x] Watchdog shows exactly which stale-cancel items would be eligible for apply.
- [x] Watchdog fails loudly if apply flags are accidentally enabled in the cron environment.
- [ ] Production cron installed and latest artifact verified.

## Phase 8: Operator Runbook

Document how to inspect, preview, and apply a single repair.

Acceptance:

- [x] Includes artifact paths.
- [x] Includes required environment flags.
- [x] Includes rollback/manual broker verification steps.
- [x] Includes "do not proceed" conditions.

Runbook: `docs/mudrex-protection-repair-operator-runbook.md`
