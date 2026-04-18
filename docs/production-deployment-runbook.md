# Production Deployment Runbook

This is the canonical production deployment path for aurAlpha.

Use this runbook for:
- DigitalOcean production deploys
- staging environments that mirror production shape
- fresh environment bootstrap
- routine application upgrades

Do not use this runbook for:
- local development
- one-off schema recovery

## Recommended topology

DigitalOcean shape:
- one Ubuntu Droplet for backend API and optional email worker
- one Ubuntu Droplet for the scheduler worker, or a separate service host in the same VPC
- managed MySQL
- managed PostgreSQL
- managed Redis
- App Platform static site or another static host for the frontend

Logical ownership:
- backend API and optional email worker:
  - this repo
- scheduler worker:
  - `../aurAlphaSchedulerWorker`
- frontend static bundle:
  - `../../Frontend/aurAlphaApp`

## Supporting docs

Use this runbook as the primary guide. Supporting docs:
- backend image and compose details:
  - `docs/backend-deploy-artifacts.md`
- backend environment checklist:
  - `docs/production-env-checklist.md`
- frontend static artifact details:
  - `../../Frontend/aurAlphaApp/docs/frontend-deploy-artifacts.md`

## Phase 0: Prerequisites

Before deployment, have:
- a production domain for the API
- a production domain for the frontend
- DigitalOcean managed MySQL
- DigitalOcean managed PostgreSQL
- DigitalOcean managed Redis
- broker credentials and encryption key material
- JWT/auth secrets
- scheduler shared secret
- frontend API and discovery endpoints decided

Expected network shape:
- backend API can reach MySQL, PostgreSQL, Redis, and the scheduler worker
- scheduler worker can reach MySQL, PostgreSQL, Redis, discovery, and broker APIs
- frontend can reach the public backend API and discovery endpoints

## Phase 1: Provision infrastructure

1. Create a DigitalOcean VPC in the target region.
2. Create Managed MySQL in that VPC.
3. Create Managed PostgreSQL in that VPC.
4. Create Managed Redis in that VPC.
5. Create the backend Droplet in that VPC.
6. Create the scheduler-worker Droplet in that VPC, or reserve a separate service host.
7. Create the frontend site target:
   - App Platform static site, or
   - another static host or CDN path
8. Create DNS records for:
   - API host
   - frontend host
   - discovery host if separate

## Phase 2: Prepare production env files

Use:
- backend checklist:
  - `docs/production-env-checklist.md`
- backend example:
  - `environments/production/.env.example`
- frontend example:
  - `../../Frontend/aurAlphaApp/environment/production/.env.example`

Required hard rules:
- `AUTH_SEED_ENABLED=false`
- `DB_SYNCHRONIZE=false`
- `REDIS_AUTO_START=false`
- `SCHEDULER_EXECUTION_MODE=queue`
- `SCHEDULER_WORKER_BASE_URL` must be explicit
- `ACTIVITY_EXPORT_STORAGE_MODE=filesystem`
- `ACTIVITY_EXPORT_STORAGE_DIR` must be explicit

## Phase 3: Deploy backend API and optional email worker

On the backend host:

1. Check out this repo.
2. Put the production env file at:
   - `./environments/production/.env`
3. Build the backend image:

```bash
docker compose -f docker-compose.prod.yml build api
```

4. Start the backend API:

```bash
docker compose -f docker-compose.prod.yml up -d api
```

5. If email delivery is enabled, start the email worker too:

```bash
docker compose -f docker-compose.prod.yml --profile email up -d email-worker
```

Notes:
- activity exports persist in the named volume mounted at `/app/storage/activity-exports`
- the backend image and compose layout are documented in `docs/backend-deploy-artifacts.md`

## Phase 4: Run backend migrations

Migrations are baseline-only now.

Run from this repo on the backend host:

```bash
npm ci
npm run build
npm run db:migrate
```

Use this sequence:
- fresh environment:
  - run migrations before opening traffic
- routine deploy:
  - build new image
  - run migrations
  - restart services on the new build

Do not use:
- old migration archives
- ad hoc schema sync

## Phase 5: Deploy the scheduler worker

On the scheduler worker host:

1. Check out:
   - `../aurAlphaSchedulerWorker`
2. Provide the worker production env file.
   Use the example at:
   - `../aurAlphaSchedulerWorker/environments/production/.env.example`
3. Build the worker:

```bash
npm ci
npm run build
```

4. Start the worker:

```bash
npm run start
```

The worker must point at the same:
- MySQL
- PostgreSQL
- Redis
- `BROKER_ACCOUNT_SECRETS_KEY`
- `DISCOVERY_SCHEDULER_SECRET`

The backend API must be configured with the matching worker URL in:
- `SCHEDULER_WORKER_BASE_URL`

## Phase 6: Deploy the frontend

From the frontend repo:
- `../../Frontend/aurAlphaApp`

1. Provide:
   - `environment/production/.env`
2. Build the static bundle:

```bash
npm ci
npm run build-production
```

3. Publish:
   - `dist/production`

Required frontend envs:
- `APP_ENV=production`
- `API_BASE_URL`
- `API_KEY`
- `DISCOVERY_API_BASE_URL`
- `DISCOVERY_WS_URL`

The frontend no longer falls back to localhost outside `APP_ENV=localhost`.

## Phase 7: Fresh environment bootstrap

For a brand new production environment:

1. Provision databases and Redis.
2. Prepare backend and worker env files.
3. Run backend migrations.
4. Start backend API.
5. Start scheduler worker.
6. Build and publish frontend.
7. Verify health endpoints.
8. Create or import the initial admin user through the approved auth path.
9. Configure brokers, connections, and policies.
10. Start syncs in this order:
    - exchange assets
    - broker assets
    - asset prices
    - funds
    - positions
    - orders
    - risk recompute
11. Run rebuild jobs if needed:
    - `npm run rebuild:positions-read-model`
    - `npm run rebuild:risk-normalized-storage`

## Phase 8: Routine upgrade path

For a normal release:

1. Put the new code on the backend host.
2. Build the backend image or backend dist.
3. Run backend migrations.
4. Restart backend API.
5. Restart email worker if enabled.
6. Deploy and restart scheduler worker if changed.
7. Build and publish the frontend if changed.
8. Run smoke checks.

## Smoke checks

Backend health:
- `GET /api/v1/health`
- `GET /api/v1/health/queue`
- `GET /api/v1/health/worker`
- `GET /api/v1/health/ops`

Recommended functional checks:
- login flow
- `GET /api/v1/overview`
- `GET /api/v1/risk/overview`
- scheduler page loads
- funds, positions, and orders pages load
- one manual scheduler run succeeds
- one risk recompute succeeds

Frontend checks:
- main app loads without localhost endpoint errors
- websocket discovery connects only if configured
- no page links point at localhost in production

## Rollback basics

If a deploy fails:

1. Keep databases at the latest successful migrated state unless a migration itself is bad.
2. Roll back the backend container or dist build to the last known-good image or artifact.
3. Roll back the worker build if the failure is scheduler-related.
4. Roll back the frontend static publish independently if only the UI is affected.
5. If the failure came from a bad migration:
   - stop writes
   - restore from database backup or approved rollback procedure
   - do not use TypeORM schema sync as a rollback shortcut

## Operational notes

- The backend repo owns the API and optional email worker only.
- The scheduler worker is a separate deployable unit.
- Activity exports currently rely on explicit filesystem storage and should be backed by durable disk on the backend host.
- If you later move exports to object storage, update both:
  - `docs/backend-deploy-artifacts.md`
  - `docs/production-env-checklist.md`
