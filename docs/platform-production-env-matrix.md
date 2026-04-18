# Platform Production Env Matrix

This is the exact env ownership map for the Docker platform stack.

Use it with:
- [production-deployment-runbook.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/production-deployment-runbook.md)
- [docker-platform-stack.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/docker-platform-stack.md)
- [production-env-checklist.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/production-env-checklist.md)

This matrix assumes **managed MySQL, PostgreSQL, and Redis/Valkey**.

If you want to run the databases on the same Droplet instead, use:
- [selfhosted-databases-on-droplet.md](/Users/apple/Documents/Project/Backend/aurAlpha/docs/selfhosted-databases-on-droplet.md)

## Public domains

Pick these first:

| Purpose | Example |
| --- | --- |
| Frontend | `app.example.com` |
| Backend API | `api.example.com` |
| Discovery | `discovery.example.com` |

## Managed services

These should live outside Docker on DigitalOcean managed services.

| Service | Example placeholder |
| --- | --- |
| MySQL host | `db-mysql-prod-do-user-xxxxx-0.l.db.ondigitalocean.com` |
| PostgreSQL host | `db-pg-prod-do-user-xxxxx-0.l.db.ondigitalocean.com` |
| Redis host | `db-redis-prod-do-user-xxxxx-0.l.db.ondigitalocean.com` |

Use the cluster connection details for ports.
Common DigitalOcean managed-database ports are:
- MySQL: `25060`
- PostgreSQL: `25060`
- Redis/Valkey over TLS: `25061`

## Shared secrets and values

Use the same value everywhere a row says `shared`.

| Variable | Shared across |
| --- | --- |
| `APP_API_KEY` | backend, frontend build, discovery `NODE_BACKEND_API_KEY` |
| `BROKER_ACCOUNT_SECRETS_KEY` | backend, worker, discovery |
| `DISCOVERY_SCHEDULER_SECRET` | backend, worker, discovery |
| MySQL credentials | backend, worker, discovery |
| PostgreSQL credentials | backend, worker, discovery |
| Redis credentials | backend, worker, discovery |

## 1. Platform compose env file

File:
- [deploy/.env.platform.example](/Users/apple/Documents/Project/Backend/aurAlpha/deploy/.env.platform.example)

Real file on server:
- `deploy/.env.platform`

| Variable | Recommended value |
| --- | --- |
| `APP_DOMAIN` | `app.example.com` |
| `API_DOMAIN` | `api.example.com` |
| `DISCOVERY_DOMAIN` | `discovery.example.com` |
| `PLATFORM_HTTP_PORT` | `80` |
| `PLATFORM_HTTPS_PORT` | `443` |
| `FRONTEND_API_BASE_URL` | `https://api.example.com/api/v1` |
| `FRONTEND_API_KEY` | same as backend `APP_API_KEY` |
| `FRONTEND_DISCOVERY_API_BASE_URL` | `https://discovery.example.com/api/v1/discovery` |
| `FRONTEND_DISCOVERY_WS_URL` | `wss://discovery.example.com/ws/discovery` |
| `FRONTEND_APP_API_TIMEOUT_MS` | `10000` |
| `DISCOVERY_NODE_BACKEND_API_KEY` | same as backend `APP_API_KEY` |

## 2. Backend API and optional email worker

File:
- [environments/production/.env.example](/Users/apple/Documents/Project/Backend/aurAlpha/environments/production/.env.example)

Real file on server:
- `environments/production/.env`

### Public identity

| Variable | Recommended value |
| --- | --- |
| `APP_ENV` | `production` |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `APP_SCHEMA` | `https` |
| `APP_HOST` | `api.example.com` |
| `APP_ROUTE_PREFIX` | `/api/v1` |
| `APP_CORS_ORIGINS` | `https://app.example.com` |

### Security

| Variable | Recommended value |
| --- | --- |
| `APP_API_KEY` | shared secret |
| `APP_REQUIRE_API_KEY` | `true` |
| `AUTH_ACCESS_TOKEN_SECRET` | strong production secret |
| `AUTH_SEED_ENABLED` | `false` |
| `BROKER_ACCOUNT_SECRETS_KEY` | shared secret |

### Internal service routing

In the platform compose stack, these are injected automatically:

| Variable | Value |
| --- | --- |
| `DISCOVERY_API_BASE_URL` | `http://discovery-engine:8000/api/v1/discovery` |
| `SCHEDULER_WORKER_SCHEMA` | `http` |
| `SCHEDULER_WORKER_HOST` | `auralpha-scheduler-worker` |
| `SCHEDULER_WORKER_PORT` | `3001` |
| `SCHEDULER_WORKER_BASE_URL` | `http://auralpha-scheduler-worker:3001` |

### Managed data services

| Variable | Recommended value |
| --- | --- |
| `DB_HOST` | managed MySQL host |
| `DB_PORT` | `25060` |
| `DB_USERNAME` | managed MySQL username |
| `DB_PASSWORD` | managed MySQL password |
| `DB_NAME` | `auralpha` |
| `PG_DB_ENABLED` | `true` |
| `PG_DB_HOST` | managed PostgreSQL host |
| `PG_DB_PORT` | `25060` |
| `PG_DB_USERNAME` | managed PostgreSQL username |
| `PG_DB_PASSWORD` | managed PostgreSQL password |
| `PG_DB_NAME` | `auralpha` |
| `PG_DB_SSL` | `true` |
| `REDIS_HOST` | managed Redis host |
| `REDIS_PORT` | `25061` when using TLS |
| `REDIS_DB` | `0` |
| `REDIS_USERNAME` | managed Redis username if required |
| `REDIS_PASSWORD` | managed Redis password |
| `REDIS_TLS` | `true` if required by managed Redis |
| `REDIS_AUTO_START` | `false` |

### Filesystem export storage

| Variable | Recommended value |
| --- | --- |
| `ACTIVITY_EXPORT_STORAGE_MODE` | `filesystem` |
| `ACTIVITY_EXPORT_STORAGE_DIR` | `/app/storage/activity-exports` |

## 3. Scheduler worker

File:
- `../aurAlphaSchedulerWorker/environments/production/.env.example`

Real file on server:
- `../aurAlphaSchedulerWorker/environments/production/.env`

### Runtime identity

| Variable | Recommended value |
| --- | --- |
| `LOG_LEVEL` | `info` |
| `WORKER_ID` | `scheduler-worker-prod` |
| `WORKER_HEARTBEAT_KEY` | `scheduler:worker:heartbeat` |
| `WORKER_HEARTBEAT_INTERVAL_MS` | `10000` |
| `WORKER_HEARTBEAT_TTL_SEC` | `30` |
| `SCHEDULER_COMMAND_POLL_INTERVAL_MS` | `5000` |
| `SCHEDULER_SYSTEM_USER_ID` | `system` |

### Internal service routing

In the platform compose stack, these are injected automatically:

| Variable | Value |
| --- | --- |
| `WORKER_HTTP_HOST` | `0.0.0.0` |
| `WORKER_HTTP_PORT` | `3001` |
| `TRADING_API_BASE_URL` | `http://auralpha-api:3000/api/v1` |
| `TRADING_API_HEALTH_URL` | `http://auralpha-api:3000/api/v1/health` |
| `DISCOVERY_ENGINE_BASE_URL` | `http://discovery-engine:8000/api/v1/discovery` |
| `DISCOVERY_ENGINE_HEALTH_URL` | `http://discovery-engine:8000/health/ready` |

### Shared services

| Variable | Recommended value |
| --- | --- |
| `DB_HOST` | managed MySQL host |
| `DB_PORT` | `25060` |
| `DB_USERNAME` | managed MySQL username |
| `DB_PASSWORD` | managed MySQL password |
| `DB_NAME` | `auralpha` |
| `PG_DB_ENABLED` | `true` |
| `PG_DB_HOST` | managed PostgreSQL host |
| `PG_DB_PORT` | `25060` |
| `PG_DB_USERNAME` | managed PostgreSQL username |
| `PG_DB_PASSWORD` | managed PostgreSQL password |
| `PG_DB_NAME` | `auralpha` |
| `PG_DB_SSL` | `true` |
| `REDIS_HOST` | managed Redis host |
| `REDIS_PORT` | `25061` when using TLS |
| `REDIS_DB` | `0` |
| `REDIS_USERNAME` | managed Redis username if required |
| `REDIS_PASSWORD` | managed Redis password |
| `REDIS_TLS` | `true` if required by managed Redis |
| `REDIS_AUTO_START` | `false` |
| `DISCOVERY_SCHEDULER_SECRET` | shared secret |
| `BROKER_ACCOUNT_SECRETS_KEY` | shared secret |

## 4. Discovery engine

File:
- `../discovery-engine/environments/production/.env.example`

Real file on server:
- `../discovery-engine/environments/production/.env`

### Public identity

| Variable | Recommended value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `8000` |
| `APP_SCHEMA` | `https` |
| `APP_HOST` | `discovery.example.com` |
| `APP_ROUTE_PREFIX` | `/api/v1/discovery` |
| `APP_CORS_ORIGINS` | `https://app.example.com` |
| `APP_API_KEY` | same as backend `APP_API_KEY` if you later require it |
| `APP_REQUIRE_API_KEY` | `false` unless you explicitly turn it on |

### Internal service routing

| Variable | Recommended value |
| --- | --- |
| `NODE_BACKEND_URL` | `http://auralpha-api:3000/api/v1` |
| `NODE_BACKEND_API_KEY` | same as backend `APP_API_KEY` |
| `SCHEDULER_WORKER_SCHEMA` | `http` |
| `SCHEDULER_WORKER_HOST` | `auralpha-scheduler-worker` |
| `SCHEDULER_WORKER_PORT` | `3001` |
| `SCHEDULER_WORKER_BASE_URL` | `http://auralpha-scheduler-worker:3001` |

### Shared services

| Variable | Recommended value |
| --- | --- |
| `REDIS_HOST` | managed Redis host |
| `REDIS_PORT` | `6379` |
| `REDIS_DB` | `0` |
| `REDIS_USERNAME` | managed Redis username if required |
| `REDIS_PASSWORD` | managed Redis password |
| `REDIS_TLS` | `true` if required by managed Redis |
| `REDIS_AUTO_START` | `false` |
| `REDIS_URL` | full managed Redis URL |
| `BROKER_ACCOUNT_SECRETS_KEY` | shared secret |
| `JWT_SECRET` | strong production secret |
| `JWT_ALGORITHM` | `HS256` |
| `DB_HOST` | managed MySQL host |
| `DB_PORT` | `25060` |
| `DB_USERNAME` | managed MySQL username |
| `DB_PASSWORD` | managed MySQL password |
| `DB_NAME` | `auralpha` |
| `DATABASE_URL` | full async PostgreSQL URL to managed PostgreSQL |
| `MYSQL_DATABASE_URL` | full async MySQL URL to managed MySQL |

## 5. Frontend

File:
- `../../Frontend/aurAlphaApp/environment/production/.env.example`

For the Docker stack, these values are passed as build args from `deploy/.env.platform`.

| Variable | Recommended value |
| --- | --- |
| `APP_ENV` | `production` |
| `API_BASE_URL` | `https://api.example.com/api/v1` |
| `API_KEY` | same as backend `APP_API_KEY` |
| `DISCOVERY_API_BASE_URL` | `https://discovery.example.com/api/v1/discovery` |
| `DISCOVERY_WS_URL` | `wss://discovery.example.com/ws/discovery` |
| `APP_API_TIMEOUT_MS` | `10000` |

## Fill order

1. Fill managed DB and Redis endpoints.
2. Fill shared secrets once.
3. Fill public domains.
4. Fill backend env file.
5. Copy the same shared values into worker and discovery env files.
6. Fill `deploy/.env.platform`.
7. Build and start the stack.
