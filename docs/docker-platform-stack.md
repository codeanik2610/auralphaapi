# Docker Platform Stack

This stack runs the full aurAlpha application layer together:

- `auralpha-api`
- `auralpha-email-worker` (optional)
- `auralpha-scheduler-worker`
- `discovery-engine`
- `auralphaapp`
- `caddy`

Use:
- [docker-compose.platform.yml](/Users/apple/Documents/Project/Backend/aurAlpha/docker-compose.platform.yml)
- [docker-compose.selfhosted-db.yml](/Users/apple/Documents/Project/Backend/aurAlpha/docker-compose.selfhosted-db.yml)
- [deploy/Caddyfile](/Users/apple/Documents/Project/Backend/aurAlpha/deploy/Caddyfile)
- [deploy/.env.platform.example](/Users/apple/Documents/Project/Backend/aurAlpha/deploy/.env.platform.example)
- [platform-production-env-matrix.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/platform-production-env-matrix.md)
- [digitalocean-droplet-first-run.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/digitalocean-droplet-first-run.md)
- [selfhosted-databases-on-droplet.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/selfhosted-databases-on-droplet.md)
- deploy helper scripts in:
  - `scripts/deploy/`

## Assumptions

- Managed MySQL, PostgreSQL, and Redis live outside Docker.
- Service-specific production env files exist at:
  - `./environments/production/.env`
  - `../aurAlphaSchedulerWorker/environments/production/.env`
  - `../discovery-engine/environments/production/.env`
- The platform compose env file is supplied with:
  - `--env-file ./deploy/.env.platform`

## Public routes

- `APP_DOMAIN` -> frontend
- `API_DOMAIN` -> backend API
- `DISCOVERY_DOMAIN` -> discovery engine

## Internal service wiring

- backend -> worker:
  - `http://auralpha-scheduler-worker:3001`
- backend -> discovery:
  - `http://discovery-engine:8000/api/v1/discovery`
- worker -> backend:
  - `http://auralpha-api:3000/api/v1`
- worker -> discovery:
  - `http://discovery-engine:8000/api/v1/discovery`
- discovery -> backend:
  - `http://auralpha-api:3000/api/v1`

## Start the stack

For a fresh DigitalOcean Droplet, use the exact command sequence in:
- [digitalocean-droplet-first-run.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/digitalocean-droplet-first-run.md)

From this repo:

```bash
cp deploy/.env.platform.example deploy/.env.platform
# fill deploy/.env.platform

docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  up -d --build
```

To include the email worker:

```bash
docker compose \
  --env-file ./deploy/.env.platform \
  -f docker-compose.platform.yml \
  --profile email \
  up -d --build
```

## Required follow-up

- Run backend migrations before opening traffic:
  - `docker compose --env-file ./deploy/.env.platform -f docker-compose.platform.yml run --rm --no-deps auralpha-api npm run db:migrate`
- Discovery Alembic migrations are handled by the discovery container entrypoint on startup.
- Point backend and discovery env files at managed database and Redis endpoints.
- If you want local DBs on the Droplet instead, use:
  - [selfhosted-databases-on-droplet.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/selfhosted-databases-on-droplet.md)
- For the full first-run sequence, use:
  - [digitalocean-droplet-first-run.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/digitalocean-droplet-first-run.md)
- For operator wrappers, use:
  - `npm run deploy:platform:env-audit`
  - `npm run deploy:platform:validate`
  - `npm run deploy:platform:launch`
  - `npm run deploy:platform:first-run`
  - `npm run deploy:platform:status`
  - `npm run deploy:platform:logs`
  - `npm run deploy:platform:restart`
  - `npm run deploy:platform:stop`
  - `npm run deploy:platform:smoke`
  - `npm run deploy:platform:update`
  - `npm run deploy:platform:post-bootstrap`
