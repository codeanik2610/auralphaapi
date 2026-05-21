# Broker Watchdog Guardrails Phase Plan

## Goal

Bring Mudrex and Delta watchdog guardrails to the same operational standard:

- Read-only audits run on schedule.
- Every issue produces a durable JSON artifact.
- Repair previews explain exactly what would be changed.
- Mutation stays disabled by default.
- Apply paths are proven through single-candidate canaries before any scheduled repair is considered.

This document is the broker-wise execution checklist. It should be updated after each phase is completed and verified in production.

## Current Safety Rule

Repair and cancellation mutation must remain disabled unless a phase explicitly calls for a controlled canary.

Required default posture:

- [x] Watchdogs may read database and broker state.
- [x] Watchdogs may write artifacts and fail on thresholds.
- [x] Repair scripts may run in dry-run/preview mode.
- [ ] Scheduled watchdogs must not mutate broker state.
- [ ] Apply flags must only be enabled for one reviewed candidate at a time.

## Mudrex Plan

### Mudrex Phase 1: Position-Resolution Watchdog Source Of Truth

Purpose: make the repo match the intended scheduled coverage for Mudrex position identity checks.

Coverage:

- [x] Position-resolution check script exists.
- [x] Position-resolution watchdog runner exists.
- [x] Add or verify `deploy/cron/auralpha-mudrex-position-resolution-watchdog`.
- [x] Confirm cron uses read-only env only.
- [x] Confirm cron writes artifacts to `/opt/auralpha/guardrail-artifacts/mudrex-position-resolution`.

Acceptance:

- [x] Cron file exists in the repo.
- [x] Cron is installed on production.
- [x] Latest production artifact proves scheduled execution.
- [x] Unsafe and unresolved thresholds default to zero.

### Mudrex Phase 2: Protection-Health Watchdog Verification

Purpose: verify the existing protection-health watchdog is active and producing usable artifacts.

Coverage:

- [x] Missing active stop-loss detection.
- [x] Missing active take-profit detection.
- [x] Partial-fill protection quantity mismatch detection.
- [x] Stale protection after terminal/closed position detection.
- [x] Unsafe position mismatch detection.
- [x] `deploy/cron/auralpha-mudrex-protection-health-watchdog` exists.

Acceptance:

- [x] Production cron is installed and active.
- [x] Latest artifact is fresh.
- [x] Artifact includes audited count, open position count, issue counts, and item details.
- [x] Apply flags are absent or false in the cron environment.

### Mudrex Phase 3: Repair Preview Production Baseline

Purpose: prove the Mudrex repair preview can classify issues safely without mutation.

Coverage:

- [x] Missing protection preview.
- [x] Mismatched partial-fill protection preview.
- [x] Stale protection cancel preview.
- [x] Manual review blocker classification.
- [x] Unsafe/unresolved mappings are blocked.

Acceptance:

- [x] Run production preview with apply disabled.
- [x] Capture artifact showing `dryRun: true`.
- [x] Capture artifact showing repair apply disabled.
- [x] Capture artifact showing stale-cancel apply disabled.
- [x] Review every candidate before allowing any canary.

### Mudrex Phase 4: Operator Runbook

Purpose: document the exact Mudrex operating process before any apply canary.

Coverage:

- [x] Artifact locations.
- [x] Preview command.
- [x] Apply command with required env flags.
- [x] Broker read-back checklist.
- [x] Database verification checklist.
- [x] Do-not-proceed conditions.
- [x] Manual recovery steps.

Acceptance:

- [x] Runbook saved under `docs/`.
- [x] Runbook references the actual scripts and artifact paths.
- [x] Runbook states mutation is disabled by default.

### Mudrex Phase 5: Single-Candidate Canary Apply

Purpose: prove one safe Mudrex repair candidate end to end.

Rules:

- [ ] Only run if a real safe candidate exists.
- [ ] Apply one candidate only.
- [ ] Enable only the minimum required env flags.
- [ ] Fresh live position read-back before mutation.
- [ ] Fresh live order read-back after mutation.
- [ ] Stop immediately after the candidate is handled.

Acceptance:

- [ ] Before artifact captured.
- [ ] Apply artifact captured.
- [ ] After artifact captured.
- [ ] Broker state matches expected protection.
- [ ] Database state matches expected protection.

### Mudrex Phase 6: Scheduled Apply Decision

Purpose: decide whether Mudrex should stay read-only/manual or support scheduled remediation.

Coverage:

- [ ] Summarize canary result.
- [ ] Confirm no unexpected broker behavior.
- [ ] Confirm partial-fill behavior.
- [ ] Confirm stale-cancel behavior.
- [ ] Decide read-only, manual apply, or scheduled apply.

Acceptance:

- [ ] If scheduled apply is not approved, cron remains read-only.
- [ ] If scheduled apply is approved, add a separate disabled-by-default cron plan first.

## Delta Plan

### Delta Phase 1: Protection-Guardrail Watchdog Source Of Truth

Purpose: make the repo match the intended scheduled coverage for Delta protection-health checks.

Coverage:

- [x] Delta protection-guardrail check script exists.
- [x] Delta protection-guardrail watchdog runner exists.
- [x] Add or verify `deploy/cron/auralpha-delta-protection-guardrail-watchdog`.
- [x] Confirm cron uses read-only env only.
- [x] Confirm cron writes artifacts to `/opt/auralpha/guardrail-artifacts/delta-protection-guardrail`.

Acceptance:

- [x] Cron file exists in the repo.
- [x] Cron is installed on production.
- [x] Latest production artifact proves scheduled execution.
- [x] Missing protection, stale protection, partial-fill mismatch, and unsafe mismatch thresholds default to zero.

### Delta Phase 2: Existing Scheduled Watchdog Verification

Purpose: verify the Delta cron jobs already represented in the repo.

Coverage:

- [x] `deploy/cron/auralpha-delta-position-resolution-watchdog` exists.
- [x] `deploy/cron/auralpha-delta-stale-protection-watchdog` exists.
- [x] Stale-protection watchdog forces repair apply off.
- [x] Stale-protection watchdog forces stale-cancel apply off.

Acceptance:

- [x] Production position-resolution cron is installed and active.
- [x] Production stale-protection cron is installed and active.
- [x] Latest artifacts are fresh.
- [x] Stale watchdog artifact confirms mutation flags are false.

### Delta Phase 3: Position-Selection Evidence Artifact

Purpose: finish the deeper explanation for why a Delta position id was selected.

Coverage:

- [x] Basic position-resolution audit exists.
- [x] Explain selected position id.
- [x] Explain rejected candidate positions.
- [x] Include account, symbol, side, open time, entry order lineage, and quantity source.
- [x] Mark ambiguous same-symbol cases as blocked.

Acceptance:

- [x] Code is validated with tests.
- [x] Artifact is committed.
- [x] Production read-only run includes the new evidence fields. Verified in `/opt/auralpha/guardrail-artifacts/delta-position-resolution/20260521T051905Z.json`: 95/95 items included `positionSelection`, all accepted exact position ids, no unresolved or unsafe mismatches.

### Delta Phase 4: Repair Preview Production Baseline

Purpose: prove Delta repair previews are safe and explainable.

Coverage:

- [x] Missing SL/TP preview.
- [x] Native bracket vs detached protection handling.
- [x] Partial-fill mismatch preview.
- [x] Stale protection cancel preview.
- [x] Manual review blocker classification.

Acceptance:

- [ ] Run production preview with apply disabled.
- [ ] Capture artifact showing `dryRun: true`.
- [ ] Capture artifact showing repair apply disabled.
- [ ] Capture artifact showing stale-cancel apply disabled.
- [ ] Review every candidate before allowing any canary.

### Delta Phase 5: Stale-Protection Canary Apply

Purpose: prove one safe Delta stale protection cancellation candidate.

Rules:

- [ ] Only run if a real safe stale candidate exists.
- [ ] Apply one candidate only.
- [ ] Require general repair apply flag.
- [ ] Require stale-cancel apply flag.
- [ ] Fresh live order read-back for every linked order.
- [ ] Confirm active, reduce-only, correct side, correct symbol, and SL/TP stop type.
- [ ] Never cancel entry orders.
- [ ] Block if same-symbol open Delta position exists.

Acceptance:

- [ ] Before artifact captured.
- [ ] Broker cancellation confirmed.
- [ ] Database state changed to `not_required`.
- [ ] After artifact captured.

### Delta Phase 6: Missing-Protection Canary Apply

Purpose: prove one safe Delta missing-protection repair candidate.

Rules:

- [ ] Only run if a real safe candidate exists.
- [ ] Apply one candidate only.
- [ ] Fresh live position read-back before mutation.
- [ ] Fresh live order read-back after mutation.
- [ ] Confirm linked SL/TP ids are persisted.
- [ ] Stop after one candidate.

Acceptance:

- [ ] Before artifact captured.
- [ ] Apply artifact captured.
- [ ] After artifact captured.
- [ ] Broker state has expected protection.
- [ ] Database state has expected linked protection ids.

### Delta Phase 7: Partial-Fill Repair Canary Apply

Purpose: prove one safe Delta partial-fill mismatch repair.

Rules:

- [ ] Only run if a real partial-fill mismatch exists.
- [ ] Apply one candidate only.
- [ ] Fresh read-back of existing protection orders.
- [ ] Cancel mismatched reduce-only protection only.
- [ ] Recreate protection at resolved filled/open quantity.
- [ ] Confirm final SL/TP quantity matches expected Delta contract quantity.

Acceptance:

- [ ] Before artifact captured.
- [ ] Broker cancellation and replacement confirmed.
- [ ] After artifact captured.
- [ ] Quantity source and unit are visible in the artifact.

### Delta Phase 8: Scheduled Apply Decision

Purpose: decide whether Delta should stay read-only/manual or support scheduled remediation.

Coverage:

- [ ] Summarize stale-cancel canary result.
- [ ] Summarize missing-protection canary result.
- [ ] Summarize partial-fill canary result.
- [ ] Confirm no native bracket regressions.
- [ ] Decide read-only, manual apply, or scheduled apply.

Acceptance:

- [ ] If scheduled apply is not approved, cron remains read-only.
- [ ] If scheduled apply is approved, add a separate disabled-by-default cron plan first.

## Shared Production Verification Checklist

Run this after any cron, watchdog, or repair-script change.

- [ ] Build completed.
- [ ] Deployment completed.
- [ ] Production container is running expected image.
- [ ] Cron file exists under `/etc/cron.d`.
- [ ] Cron logs show execution.
- [ ] JSON artifact written under `/opt/auralpha/guardrail-artifacts`.
- [ ] Artifact is fresh.
- [ ] Artifact includes audited count.
- [ ] Artifact includes issue counts.
- [ ] Artifact includes item-level details when issues exist.
- [ ] Mutation flags are absent or false.
- [ ] No broker order was created, amended, or cancelled during read-only phases.

## Recommended Execution Order

1. Mudrex Phase 1.
2. Delta Phase 1.
3. Mudrex Phase 2.
4. Delta Phase 2.
5. Delta Phase 3.
6. Mudrex Phase 3.
7. Delta Phase 4.
8. Mudrex Phase 4.
9. Canary phases only when real safe candidates exist.
