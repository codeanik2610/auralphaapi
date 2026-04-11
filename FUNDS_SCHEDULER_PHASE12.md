## Funds Scheduler Phase 12

Phase 12 moves funds promotion readiness from ad hoc environment variables into the
`funds-sync` scheduler config itself.

What changed:

- `PUT /scheduler/funds/config` now accepts `fundsHealthThresholds`.
- `GET /scheduler/funds/config` now returns the normalized threshold policy.
- `GET /scheduler/funds/summary` now returns both `fundsHealthThresholds` and
  `fundsHealthThresholdProfile`.
- `check:funds-scheduler-health` now uses persisted config thresholds by default and only
  applies `FUNDS_SCHEDULER_MAX_*` values as explicit per-run overrides.

Why this matters:

- bounded thresholds are now durable and reviewable through the funds scheduler API
- live proof no longer needs an unbounded-threshold acknowledgement when config is bounded
- strict promotion proof can narrow its blocked reason to the real environment posture
  instead of a missing control-plane feature

What Phase 12 does not fake:

- localhost is still not a target environment
- placeholder evidence is still not production evidence
- missing snapshot coverage still has to be addressed in the actual target environment
