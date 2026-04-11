# Risk Center Phase 1

Date: 2026-04-09

## 1) Goal
Phase 1 for `/risk-center` focuses on backend correctness first.

The risk workspace should stop accepting invalid policy configurations, stop allowing duplicate
targets through the backend, and stop evaluating the wrong policy at order time.

## 2) What Changed
### Policy write validation
`POST /api/v1/risk/policies` and `PUT /api/v1/risk/policies/:policyId` now enforce stricter
server-side validation in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/risk.validator.ts`.

Phase 1 validation changes:

- `scope` is restricted to `user` or `broker`
- broker keys are normalized to trimmed lowercase values
- boolean fields are explicitly parsed instead of relying on JS truthiness
- `monitorOnly=true` and `enforceHardBlock=true` is rejected as invalid configuration
- warning thresholds must be less than or equal to their matching critical thresholds
- loss-window limits must be monotonic: daily <= weekly <= monthly

### Duplicate protection
Policy writes now reject duplicate targets in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskService.ts`
and
`/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/RiskPolicyRepository.ts`.

Phase 1 now enforces:

- at most one user-default policy per user
- at most one broker policy per `(userId, brokerKey)`
- conflict-safe error mapping when the DB unique index catches a concurrent duplicate write

### Effective policy precedence
Pre-trade enforcement now resolves the effective policy through
`RiskPolicyRepository.getEffectivePolicy(...)`.

The runtime order now matches the Phase 0 contract:

1. enabled broker-specific policy for the resolved broker
2. enabled user-default policy
3. no active policy

This fixes the earlier bug where a newer user-default policy could shadow a broker-specific policy.

### DB integrity
Phase 1 adds
`/Users/apple/Documents/Project/Backend/aurAlpha/src/database/migrations/1770600000000-HardenRiskPolicyTargetIntegrity.ts`.

That migration:

- normalizes stored `scope` and `broker_key` values
- asserts valid scopes and broker-target completeness
- asserts there are no mode conflicts or threshold-order violations
- adds a generated normalized target key
- adds a unique index enforcing one policy target per owner

## 3) Phase 1 Outcome
`/risk-center` policy writes and pre-trade evaluation now agree on the same target model.

The backend is stricter, more deterministic, and safer for Phase 2 work. Invalid policy sets are no
longer treated as a frontend-only concern.

## 4) Known Carry-Forward For Phase 2
- `/risk-center` overview is still snapshot-first and not a live broker telemetry surface
- weekly/monthly usage and broker KPI truthfulness are still frontend/backend data-contract work
- pre-trade runtime still only guarantees `maxLeverage` and `maxOrderAllocation`
- kill switch, recompute, and capacity remain deferred from the trustworthy operator workflow
- the new DB integrity migration still needs to be applied in real environments via `npm run db:migrate`

## 5) Verification
Phase 1 verification passed with:

- `npm run test:risk-center-contract`
- `npm run test:risk-center-phase1`
- `npm run test:controllers`
- `npx eslint src/api/validators/risk.validator.ts src/database/repositories/RiskPolicyRepository.ts src/database/entities/RiskPolicy.ts src/api/services/RiskService.ts src/database/migrations/1770600000000-HardenRiskPolicyTargetIntegrity.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase1.ts`
