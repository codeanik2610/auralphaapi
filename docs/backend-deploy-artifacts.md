# Backend Deploy Artifacts

For the full production process, use:
- `docs/production-deployment-runbook.md`

For the env matrix, use:
- `docs/production-env-checklist.md`

This repo now contains the backend-specific production deploy surface for the backend application.

## Included artifacts

- `Dockerfile`
  - builds the backend once and can run either:
    - `node dist/app.js`
    - `node dist/app.email-worker.js`
- `docker-compose.prod.yml`
  - starts the API service
  - optionally starts the email worker with the `email` profile
- `.dockerignore`
  - keeps local env files, archived scripts, docs, and editor artifacts out of the build context

## Runtime scope of this repo

This backend repo owns:
- API runtime
- optional email worker runtime

This backend repo does **not** own the scheduler worker runtime.
The scheduler worker lives in the sibling repo:
- `../aurAlphaSchedulerWorker`

Deploy that worker separately when you deploy the full platform.

## Compose usage

Build and start the API:

```bash
docker compose -f docker-compose.prod.yml up -d --build api
```

Start the API plus email worker:

```bash
docker compose -f docker-compose.prod.yml --profile email up -d --build
```

## Required environment

`docker-compose.prod.yml` expects:
- `./environments/production/.env`

At minimum, production must explicitly provide:
- app/API secrets
- MySQL connection settings
- PostgreSQL connection settings
- Redis connection settings
- scheduler worker URL
- activity export storage settings

## Filesystem note

Activity exports currently run in:
- `ACTIVITY_EXPORT_STORAGE_MODE=filesystem`

Filesystem-backed exports write to:
- `/app/storage/activity-exports`

In compose, this is backed by the named volume:
- `activity-exports`

If you later move to App Platform or another ephemeral runtime, replace this with durable object storage such as Spaces.
