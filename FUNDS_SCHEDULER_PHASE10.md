# Funds Scheduler Phase 10

Date: 2026-04-10

## 1) Goal
Phase 10 closes the honesty gap that remained after Phase 9.

Phase 9 proved that the live release workflow can run end to end on a real backend.
What it did not do was make the resulting artifacts explicit about:

- whether the evidence URLs were real staging or production evidence versus localhost placeholders
- whether the live health run used bounded coverage thresholds or effectively unbounded posture
- whether the final proof package was ready for real deployment promotion versus only local workflow verification

Phase 10 hardens that gap so the artifacts themselves tell the truth.

## 2) What Phase 10 Adds
### Persisted live funds health snapshot
`scripts/check-funds-scheduler-health.ts` now supports:

- `FUNDS_SCHEDULER_HEALTH_OUTPUT_FILE`

When provided, the live health check writes a structured snapshot that includes:

- scheduler coverage counts
- latency measurements
- configured threshold values
- derived `thresholdProfile.mode`

That lets the release gate and signoff reason from the real live posture instead of only from exit codes.

### Release gate now carries live health posture
`scripts/release-gate-funds-scheduler.ts` now:

- runs the new Phase 10 regression suite
- captures the persisted funds health snapshot during live checks
- embeds that snapshot into `artifacts/funds-scheduler-release-gate.json`

So the gate artifact now contains both pass/fail status and the live coverage posture that produced it.

### Signoff now distinguishes local proof from deployment-ready proof
`scripts/signoff-funds-scheduler.ts` now classifies evidence inputs as:

- `remote_url`
- `localhost_url`
- `local_path`
- `missing`

It also derives a threshold profile from the live health snapshot.

The signoff result now records:

- `deploymentEvidenceReady`
- `thresholdProfileMode`
- `productionPromotionReady`

If a run uses localhost or local-file evidence, or if thresholds are unbounded, signoff can still succeed for local verification only when that posture is explicitly acknowledged through env vars:

- `FUNDS_SCHEDULER_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED=true`
- `FUNDS_SCHEDULER_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED=true`

That means local workflow checks stay possible, but they are no longer silently indistinguishable from real promotion evidence.

### Proof now writes a deployment evidence package
`scripts/proof-funds-scheduler-live.ts` still writes:

- `artifacts/funds-scheduler-live-proof.json`

and now also writes:

- `artifacts/funds-scheduler-deployment-evidence.json`

The new evidence package bundles:

- release gate and signoff file references
- evidence classification
- readiness flags
- threshold profile
- captured live health snapshot

This closes the Phase 9 “archive the proof with deployment evidence” carry-forward in a repo-native way.

## 3) Operational Meaning
After Phase 10, a funds proof can be in one of two honest states:

1. local workflow proof
   when localhost evidence or unbounded thresholds are acknowledged
2. deployment promotion proof
   when evidence is remote and the threshold profile is bounded

Both can be `decision = ready`, but only the second should be treated as promotion-ready.
That distinction now exists in machine-readable artifacts instead of being left to chat context.

## 4) Verification
Focused verification for Phase 10:

- `npm run test:funds-scheduler-phase10`
- `npm run test:funds-scheduler-phase7`
- `npm run test:funds-scheduler-phase8`
- `npm run test:funds-scheduler-phase1`
- `npm run test:funds-scheduler-phase6`
- `npx eslint scripts/check-funds-scheduler-health.ts scripts/release-gate-funds-scheduler.ts scripts/signoff-funds-scheduler.ts scripts/proof-funds-scheduler-live.ts scripts/test-funds-scheduler-phase7.ts scripts/test-funds-scheduler-phase8.ts scripts/test-funds-scheduler-phase10.ts`

Live verification should run:

- `npm run proof:funds-scheduler-live`

with explicit acknowledgement env vars when the environment is still localhost-bound or uses unbounded thresholds.

## 5) Phase 11 Entry Criteria
Phase 11 can now assume:

- the live funds release gate captures health posture, not only command outcomes
- signoff distinguishes local placeholder proof from deployment-grade proof
- the repo produces a deployment evidence package alongside the proof artifact

Recommended next step:

- configure real staging or production evidence URLs and bounded funds health thresholds so `productionPromotionReady` can turn true in a target environment without acknowledgement overrides
