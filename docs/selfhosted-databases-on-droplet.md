# Self-Hosted Databases On The Droplet

Use this path when you want to run MySQL, PostgreSQL, and Redis on the same Droplet as the aurAlpha application stack instead of paying for separate DigitalOcean managed databases.

Use it with:
- [docker-platform-stack.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/docker-platform-stack.md)
- [digitalocean-droplet-first-run.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/digitalocean-droplet-first-run.md)
- [platform-production-env-matrix.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/platform-production-env-matrix.md)

## Files

- self-hosted DB compose override:
  - [docker-compose.selfhosted-db.yml](/Users/apple/Documents/Project/Backend/aurAlpha/docker-compose.selfhosted-db.yml)
- shared platform env file:
  - [deploy/.env.platform.example](/Users/apple/Documents/Project/Backend/aurAlpha/deploy/.env.platform.example)

Directory naming reminder:
- backend uses `environments`
- scheduler worker uses `environments`
- discovery engine uses `environments`
- frontend uses `environment`

## What this adds

The override adds three internal-only services on the Docker `core` network:

- `mysql`
- `postgres`
- `redis`

They are not published on public host ports.

## Required env changes

### 1. Platform env file

Fill these in `deploy/.env.platform`:

```env
SELFHOSTED_MYSQL_DATABASE=auralpha
SELFHOSTED_MYSQL_USERNAME=auralpha
SELFHOSTED_MYSQL_PASSWORD=replace-with-strong-password
SELFHOSTED_MYSQL_ROOT_PASSWORD=replace-with-strong-root-password
SELFHOSTED_POSTGRES_DATABASE=auralpha
SELFHOSTED_POSTGRES_USERNAME=auralpha
SELFHOSTED_POSTGRES_PASSWORD=replace-with-strong-password
SELFHOSTED_REDIS_PASSWORD=replace-with-strong-password
```

### 2. Backend env

Set these in `environments/production/.env`:

```env
DB_HOST=mysql
DB_PORT=3306
DB_NAME=auralpha

PG_DB_HOST=postgres
PG_DB_PORT=5432
PG_DB_NAME=auralpha
PG_DB_SSL=false

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_TLS=false
REDIS_AUTO_START=false
```

### 3. Scheduler worker env

Set these in `../aurAlphaSchedulerWorker/environments/production/.env`:

```env
DB_HOST=mysql
DB_PORT=3306
DB_NAME=auralpha

PG_DB_HOST=postgres
PG_DB_PORT=5432
PG_DB_NAME=auralpha
PG_DB_SSL=false

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_TLS=false
REDIS_AUTO_START=false
```

### 4. Discovery env

Set these in `../discovery-engine/environments/production/.env`:

```env
DB_HOST=mysql
DB_PORT=3306
DB_NAME=auralpha

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_TLS=false
REDIS_AUTO_START=false

DATABASE_URL=postgresql+asyncpg://auralpha:replace-with-strong-password@postgres:5432/auralpha
MYSQL_DATABASE_URL=mysql+aiomysql://auralpha:replace-with-strong-password@mysql:3306/auralpha
REDIS_URL=redis://:replace-with-strong-password@redis:6379/0
```

## Launch flow

From the backend repo on the Droplet:

```bash
cd /opt/auralpha/Backend/aurAlpha
export PLATFORM_COMPOSE_OVERRIDE_FILE=./docker-compose.selfhosted-db.yml
npm run deploy:platform:launch
```

What happens:

1. the helper scripts load both compose files
2. the local `mysql`, `postgres`, and `redis` containers are started first
3. the platform env audit checks the extra self-hosted DB passwords and hostnames
4. backend migrations run against the local database containers
5. the main application stack starts

## Validation flow

Before launching, you can validate only:

```bash
cd /opt/auralpha/Backend/aurAlpha
export PLATFORM_COMPOSE_OVERRIDE_FILE=./docker-compose.selfhosted-db.yml
npm run deploy:platform:env-audit
npm run deploy:platform:validate
```

## Important tradeoffs

This is cheaper than DigitalOcean managed databases, but it is not highly available.

If the Droplet goes down:
- app services go down
- MySQL goes down
- PostgreSQL goes down
- Redis goes down

Recommended minimum safety:

- enable Droplet backups
- take regular snapshots before major upgrades
- keep DB services private only
- do not open ports `3306`, `5432`, or `6379` publicly
- strongly consider a separate attached volume for database data later
