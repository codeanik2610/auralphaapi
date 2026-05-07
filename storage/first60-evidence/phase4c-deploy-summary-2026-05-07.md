# Phase 4c Deploy Summary - 2026-05-07

## Scope

Deployed the Phase 4c First60 readiness package to `root@168.144.66.167` under `/opt/auralpha/Backend/aurAlpha`.

Scoped package:

- `package.json`
- `src/api/utils/strategyTemplateAutomation.ts`
- `src/api/services/StrategyTemplatesService.ts`
- `src/api/services/AutomationExecutionService.ts`
- `src/api/utils/first60TemplateSimulator.ts`
- `src/api/utils/first60ObserveOnlyMonitor.ts`
- `scripts/diagnostics/run-first60-template-simulator.ts`
- `scripts/checks/check-first60-observe-only-monitor.ts`
- `scripts/checks/check-first60-deploy-readiness.ts`
- `docs/first60-managed-template-plan.md`
- `docs/first60-deploy-readiness-runbook.md`

Remote backup was created at:

- `/tmp/auralpha-first60-phase4c-backup-2026-05-07`

## Deployment Result

`scripts/deploy/platform-update.sh` completed successfully with the self-hosted DB compose override.

- Backend, app, scheduler worker, and discovery images rebuilt.
- MySQL migrations applied: `0`
- Postgres migrations applied: `0`
- Containers restarted successfully.

After a readiness-check marker false positive was found, `scripts/checks/check-first60-deploy-readiness.ts` was updated to look for runtime JavaScript markers instead of TypeScript-only type names. The backend API image was rebuilt and restarted again.

## Runtime Evidence

Compiled runtime files exist in the backend container:

- `/app/dist/scripts/checks/check-first60-deploy-readiness.js`
- `/app/dist/scripts/checks/check-first60-observe-only-monitor.js`
- `/app/dist/scripts/diagnostics/run-first60-template-simulator.js`

Readiness check inside `auralpha-auralpha-api-1`:

- Status: `warn`
- Failures: `0`
- Expected warnings:
  - Runtime image does not include `docs/first60-deploy-readiness-runbook.md`.
  - Non-live run skips DB checks.

Live readiness check inside `auralpha-auralpha-api-1`:

- Status: `warn`
- Failures: `0`
- Lookback: `72` hours
- First60 snapshots: `0`
- First60 snapshots with decision gate: `0`
- Existing observe-only results: `0`
- Expected warning: no recent First60 snapshots exist yet because no newly generated trades have been snapshotted after deployment.

Observe-only monitor dry-run inside `auralpha-auralpha-api-1`:

- Mode: `dry-run`
- Lookback: `72` hours
- Candidates: `0`
- Evaluated: `0`
- Written: `0`

Container status after deploy:

- `auralpha-auralpha-api-1`: healthy
- `auralpha-auralphaapp-1`: healthy
- `auralpha-discovery-engine-1`: healthy
- `auralpha-auralpha-scheduler-worker-1`: healthy
- `auralpha-mysql-1`: healthy
- `auralpha-postgres-1`: healthy
- `auralpha-redis-1`: healthy

## Gate

Phase 4c package is deployed and runtime-verified. The next useful gate is to wait for newly generated suggested trades to include `meta.tradeManagementSnapshot.first60`, then rerun the observe-only monitor in dry-run mode against those fresh trades.
