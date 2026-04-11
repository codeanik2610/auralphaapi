# Broker Assets Phase 7

Date: 2026-04-10

## 1) Goal
Phase 7 turns broker-assets into a release-ready workflow.

By the end of this phase `broker_assets` should have:

- a health check that can describe threshold posture instead of only pass or fail
- a release gate that can optionally carry live broker-assets evidence
- a final signoff step that records explicit operator verification for the
  global catalog, connected-broker visibility, Delta lookup, and provider
  identity posture

Phase 7 does not change broker-assets ownership again.
It makes the current global-catalog model releasable.

## 2) What Changed
### The broker-assets health check now exposes threshold posture
`/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-broker-assets-health.ts`
now exports:

- `resolveBrokerAssetsHealthThresholds`
- `buildBrokerAssetsHealthThresholdProfile`
- `buildBrokerAssetsHealthSnapshot`
- `assertBrokerAssetsHealthSnapshot`

The health check still validates the global queue, worker, scheduler config,
admin catalog, and user-visible asset routes, but it can now also capture:

- optional admin and visible latency thresholds
- optional global minimum-result thresholds
- source-specific minimum visible-result checks
- a serialized threshold profile (`bounded`, `partial`, or `unbounded`)

Those thresholds remain opt-in so Phase 7 does not force environment-specific
numbers into `test:all`.

### Broker-assets release gate now supports optional live health
Phase 7 expands:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-broker-assets.ts`
- `npm run release-gate:broker-assets`

The release gate now runs:

- backend broker-assets contract suite
- backend broker-assets flow proof
- backend broker-assets Phase 6 guard
- backend broker-assets Phase 7 guard
- broker-assets scoped lint checks
- optional live broker-assets health via `BROKER_ASSETS_RUN_LIVE_CHECKS=true`

It writes the gate result to:

- `artifacts/broker-assets-release-gate.json`

and, when live checks are enabled, it also carries the broker-assets health
snapshot path and payload in the gate artifact.

### Broker-assets now has a final signoff workflow
Phase 7 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-broker-assets.ts`
- `npm run signoff:broker-assets`

The signoff script consumes the release-gate artifact and enforces explicit
verification for:

- global catalog ownership
- connected-broker user visibility
- Delta product lookup against the global catalog
- source-threshold posture
- provider identity and uniqueness review

It can also optionally require:

- inline live health from the release gate
- the Phase 6 `proof:broker-assets-live` artifact as manual promotion evidence

The signoff result is written to:

- `artifacts/broker-assets-signoff.json`

This is the Phase 7 answer to the Phase 6 request to wire live proof into a
manual release-evidence path without putting that live path into the default
test lane.

### Focused Phase 7 coverage now exists
Phase 7 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-broker-assets-phase7.ts`
- `npm run test:broker-assets-phase7`

That focused suite verifies:

- the broker-assets health snapshot and assertion helpers support bounded
  source-aware thresholds
- the broker-assets signoff script succeeds against a ready gate plus ready
  proof artifact
- the release gate, package wiring, README notes, and operational audit all
  include the Phase 7 release workflow markers

### Rename and identity boundaries are now explicit
Phase 7 makes two deliberate decisions from the Phase 6 checklist:

- the compatibility symbols `ExchangeAsset`, `ExchangeAssetRepository`, and
  `ExchangeAssetsService` remain deferred; Phase 7 is not the no-behavior
  rename pass
- stronger uniqueness rules beyond `(source, symbol)` remain deferred until
  observed provider data proves them safe for every supported source

## 3) Phase 7 Outcome
Broker-assets now has a clean release chain instead of a loose set of scripts:

1. `test:broker-assets` proves the stable contract, runtime flow, and Phase 6/7 guardrails
2. `check:broker-assets-health` proves the live queue, worker, global scheduler, and threshold posture
3. `release-gate:broker-assets` aggregates the local release checks and can optionally capture live health
4. `signoff:broker-assets` records the final operator verification and evidence posture

That is the stable baseline Phase 8 can now build on.

## 4) Carry-Forward For Phase 8
- update `proof:broker-assets-live` so it runs the release gate with live checks
  and then runs `signoff:broker-assets` to emit one combined proof artifact
- run the broker-assets release gate and signoff against the target environment
  with real credentials, real thresholds, and real evidence links
- decide whether the deferred `ExchangeAsset*` compatibility rename still adds
  enough value to justify a dedicated no-behavior cleanup phase

All three Phase 8 carry-forward items were addressed in `BROKER_ASSETS_PHASE8.md`.

## 5) Verification
Phase 7 verification passed with:

- `npm run test:broker-assets-phase6`
- `npm run test:broker-assets-phase7`
- `npm run test:broker-assets`
- `npm run release-gate:broker-assets`
- `BROKER_ASSETS_SIGNOFF_GATE_FILE=artifacts/broker-assets-release-gate.json BROKER_ASSETS_SIGNOFF_GLOBAL_CATALOG_VERIFIED=true BROKER_ASSETS_SIGNOFF_CONNECTED_VISIBILITY_VERIFIED=true BROKER_ASSETS_SIGNOFF_DELTA_LOOKUP_VERIFIED=true BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED=true BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED=true BROKER_ASSETS_SIGNOFF_PLACEHOLDER_EVIDENCE_ACKNOWLEDGED=true BROKER_ASSETS_SIGNOFF_UNBOUNDED_THRESHOLDS_ACKNOWLEDGED=true BROKER_ASSETS_SIGNOFF_APPROVER=codex-phase7 npm run signoff:broker-assets`
- `npm run test:operational-audit`
- `npx eslint scripts/check-broker-assets-health.ts scripts/release-gate-broker-assets.ts scripts/signoff-broker-assets.ts scripts/test-broker-assets-phase6.ts scripts/test-broker-assets-phase7.ts scripts/test-operational-audit.ts`

`npm run proof:broker-assets-live` was not changed into the final combined
release proof in this phase. That integration is the intended Phase 8 step.
