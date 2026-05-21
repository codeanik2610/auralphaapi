# Delta Guardrail Phase Plan

## Goal

Keep Delta protection behavior safe while closing the remaining visibility gaps around position identity, partial fills, stale protection, and controlled repair.

Delta currently has broader protection-health coverage than Mudrex, plus a separate stale-protection watchdog. Position-resolution evidence and repair-preview production baseline are now verified; the remaining work is staged canary apply only when real candidates appear.

## Current Coverage

- [x] Scheduled Delta protection guardrail every 30 minutes.
- [x] Detects missing position read-model binding.
- [x] Detects missing active stop-loss.
- [x] Detects missing active take-profit.
- [x] Detects stale protection for closed positions.
- [x] Detects partial-fill protection quantity mismatch.
- [x] Detects unsafe position mismatch.
- [x] Scheduled stale-protection watchdog every 10 minutes.
- [x] Stale-protection watchdog forces both apply flags off.
- [x] Stale-protection watchdog writes artifacts and fails on stale candidates.
- [x] Position-selection evidence explains selected and rejected Delta position candidates.
- [x] Production repair preview baseline is verified with apply flags disabled.

## Missing Coverage

- [x] Mudrex-style position-resolution detail report.
- [x] Separate position identity watchdog focused only on Delta mapping quality.
- [x] Deeper "why this position id was chosen" artifact.
- [x] Production repair preview baseline before canary apply.
- [ ] Production canary apply for repair path when a real safe candidate appears.
- [x] Operator runbook for single-candidate Delta repair.

## Phase 1: Position Resolution Read-Only Audit

Build a Delta position-resolution report similar in shape to Mudrex, but using Delta-specific identifiers and order/position payloads.

Coverage:

- [x] Exact position id binding.
- [x] Account id match.
- [x] Symbol/base symbol match.
- [x] Side match.
- [x] Entry order to position lineage.
- [x] Same-symbol ambiguity count.
- [x] Position payload source used for quantity.

Acceptance:

- [x] Produces JSON with audited count and by-type counts.
- [x] Reports unresolved and unsafe mappings separately.
- [x] Does not duplicate or weaken the existing protection guardrail.

## Phase 2: Scheduled Delta Position Watchdog

Add a Docker runner and cron entry for the Phase 1 position-resolution report.

Coverage:

- [x] Runs every 30 minutes.
- [x] Writes JSON and log artifacts.
- [x] Thresholds default to zero unsafe mappings.

Acceptance:

- [x] Cron definition added under `deploy/cron`.
- [x] Latest artifact proves scheduled execution.
- [x] No broker mutation is possible.

## Phase 3: Partial-Fill Repair Preview Hardening

Review and harden the existing Delta repair preview for partial fills.

Coverage:

- [x] Candidate quantity comes from filled/open size, not requested size.
- [x] Quantity unit is explicit: contracts, base, or unknown.
- [x] Contract conversion requires contract value evidence.
- [x] Existing SL/TP order ids are included before replacement.
- [x] Unsafe or ambiguous mappings are blocked.

Acceptance:

- [x] Preview explains quantity source and blockers.
- [x] No apply path can run without fresh read-back.

## Phase 4: Missing SL/TP Repair Preview Hardening

Review and harden the existing Delta repair preview for missing protection.

Coverage:

- [x] Missing SL only.
- [x] Missing TP only.
- [x] Missing both SL and TP.
- [x] Native bracket protection mode.
- [x] Detached protection mode.

Acceptance:

- [x] Preview separates attach from reconcile.
- [x] Preview never creates duplicate protection for native bracket orders.
- [x] Preview blocks if planned SL/TP price is missing.

## Phase 4A: Repair Preview Production Baseline

Run the production repair preview and dry-run with mutation disabled before any canary apply.

Acceptance:

- [x] Preview artifact shows `dryRun: true`: `/opt/auralpha/guardrail-artifacts/delta-protection-repair-preview/20260521T052956Z-preview.json`.
- [x] Dry-run artifact shows `applyEnabled: false`: `/opt/auralpha/guardrail-artifacts/delta-protection-repair-preview/20260521T052956Z-dry-run.json`.
- [x] Dry-run artifact shows `staleCancelApplyEnabled: false`: `/opt/auralpha/guardrail-artifacts/delta-protection-repair-preview/20260521T052956Z-dry-run.json`.
- [x] Candidate review completed. Baseline found zero candidates: audited 240, open positions 1, issue trades 0, repairable items 0, blocked items 0, manual review items 0.

## Phase 5: Stale Protection Canary Apply

Only if the scheduled stale-protection watchdog finds a real candidate.

Rules:

- [ ] Apply one candidate only.
- [ ] Require both general repair apply and stale-cancel apply flags.
- [ ] Fresh live order read-back for every linked order.
- [ ] Confirm active, reduce-only, correct side, correct symbol, and SL/TP stop type.
- [ ] Never cancel the entry order.
- [ ] Block if a same-symbol open Delta position exists.

Acceptance:

- [ ] Before artifact captured.
- [ ] Broker cancellation confirmed.
- [ ] Database state changed to `not_required`.
- [ ] After artifact captured.

## Phase 6: Missing Protection Canary Apply

Only after read-only previews are clean and a real safe candidate exists.

Rules:

- [ ] Apply one missing-protection candidate only.
- [ ] Fresh position read-back before mutation.
- [ ] Fresh order read-back after mutation.
- [ ] Confirm linked order ids persisted.
- [ ] Stop for review after one candidate.

## Phase 7: Partial-Fill Repair Canary Apply

Only after a real partial-fill mismatch appears.

Rules:

- [ ] Apply one candidate only.
- [ ] Fresh read-back of existing protection orders.
- [ ] Cancel mismatched reduce-only protection only.
- [ ] Recreate protection at resolved filled/open quantity.
- [ ] Confirm final SL/TP quantity matches expected contracts.

## Phase 8: Operator Runbook

Document how to inspect, preview, and safely apply a single Delta repair.

Acceptance:

- [x] Includes artifact paths for all Delta watchdogs.
- [x] Includes required environment flags.
- [x] Includes broker read-back checklist.
- [x] Includes "do not proceed" conditions.
- [x] Includes manual verification steps in Delta Exchange.

Runbook: `docs/delta-protection-repair-operator-runbook.md`
