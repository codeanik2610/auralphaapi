# Funds Scheduler Phase 11

Phase 11 turns the funds scheduler proof chain into a strict promotion-readiness workflow.

## What changed

- `signoff:funds-scheduler` now records whether live health is coming from a real remote target environment or from localhost.
- `proof:funds-scheduler-promotion` runs the release gate with live checks, requires remote deployment evidence, requires bounded thresholds, and refuses placeholder acknowledgements.
- Blocked signoff and promotion runs now leave artifacts behind so the failure posture is inspectable instead of disappearing into an exit code.

## Promotion rule

Promotion is only ready when all of these are true:

- live health comes from a remote target environment, not localhost
- deployment evidence URLs are remote
- threshold posture is `bounded`
- placeholder evidence acknowledgement is not used
- unbounded threshold acknowledgement is not used

## Commands

- Local live proof: `npm run proof:funds-scheduler-live`
- Strict promotion proof: `npm run proof:funds-scheduler-promotion`

`proof:funds-scheduler-live` is still useful on localhost for workflow verification.
`proof:funds-scheduler-promotion` is intentionally stricter and should block on localhost evidence, localhost health URLs, or unbounded threshold posture.

## Artifacts

- `artifacts/funds-scheduler-release-gate.json`
- `artifacts/funds-scheduler-signoff.json`
- `artifacts/funds-scheduler-live-proof.json`
- `artifacts/funds-scheduler-deployment-evidence.json`
- `artifacts/funds-scheduler-promotion-proof.json`

## Handoff

Use Phase 11 to prove the workflow is honest.
Use the next phase to run the strict promotion proof against an actual staging or production target with real remote evidence links.
