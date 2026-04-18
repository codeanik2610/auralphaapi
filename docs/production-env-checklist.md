# Production Environment Checklist

This checklist is the production env reference for all deployable parts of aurAlpha.

Use it with:
- `docs/production-deployment-runbook.md`

## Backend API and optional email worker

Reference file:
- `environments/production/.env.example`

### Identity and HTTP
- `APP_ENV=production`
- `NODE_ENV=production`
- `PORT`
- `APP_NAME`
- `APP_SCHEMA`
- `APP_HOST`
- `APP_ROUTE_PREFIX`
- `APP_API_KEY`
- `APP_REQUIRE_API_KEY=true`
- `APP_CORS_ORIGINS`
- `HTTP_REQUEST_TIMEOUT_MS`

### Logging
- `LOG_LEVEL`

### Auth and security
- `AUTH_ACCESS_TOKEN_SECRET`
- `AUTH_ACCESS_TOKEN_TTL`
- `AUTH_REFRESH_TOKEN_DAYS`
- `AUTH_LOGIN_PROTECTION_ENABLED=true`
- `AUTH_LOGIN_MAX_ATTEMPTS`
- `AUTH_LOGIN_IP_MAX_ATTEMPTS`
- `AUTH_LOGIN_WINDOW_MINUTES`
- `AUTH_LOGIN_LOCKOUT_MINUTES`
- `AUTH_SEED_ENABLED=false`
- `BROKER_ACCOUNT_SECRETS_KEY`

### Activity export storage
- `ACTIVITY_EXPORT_STORAGE_MODE=filesystem`
- `ACTIVITY_EXPORT_STORAGE_DIR`

### Discovery and scheduler integration
- `DISCOVERY_API_BASE_URL`
- `SCHEDULER_EXECUTION_MODE=queue`
- `SCHEDULER_SYSTEM_USER_ID`
- `SCHEDULER_WORKER_SCHEMA`
- `SCHEDULER_WORKER_HOST`
- `SCHEDULER_WORKER_PORT`
- `SCHEDULER_WORKER_BASE_URL`
- `DISCOVERY_SCHEDULER_SECRET`

### Redis
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_DB`
- `REDIS_USERNAME`
- `REDIS_PASSWORD`
- `REDIS_TLS`
- `REDIS_AUTO_START=false`
- `WORKER_HEARTBEAT_KEY`

### MySQL
- `DB_HOST`
- `DB_PORT`
- `DB_USERNAME`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SYNCHRONIZE=false`
- `DB_LOGGING=false`

### PostgreSQL
- `PG_DB_ENABLED=true`
- `PG_DB_HOST`
- `PG_DB_PORT`
- `PG_DB_USERNAME`
- `PG_DB_PASSWORD`
- `PG_DB_NAME`
- `PG_DB_SSL=true`
- `PG_DB_LOGGING=false`

## Scheduler worker

Repo:
- `../aurAlphaSchedulerWorker`

Reference file:
- `../aurAlphaSchedulerWorker/environments/production/.env.example`

### Logging
- `LOG_LEVEL`

### Redis
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_DB`
- `REDIS_USERNAME`
- `REDIS_PASSWORD`
- `REDIS_TLS`
- `REDIS_AUTO_START=false`

### Worker identity and polling
- `WORKER_ID`
- `WORKER_HEARTBEAT_KEY`
- `WORKER_HEARTBEAT_INTERVAL_MS`
- `WORKER_HEARTBEAT_TTL_SEC`
- `SCHEDULER_COMMAND_POLL_INTERVAL_MS`

### Broker/discovery runtime
- `BINANCE_FUTURES_BASE_URL`
- `CANDLES_INTERVAL`
- `CANDLES_LOOKBACK_DAYS`
- `DISCOVERY_SCHEDULER_SECRET`
- `BROKER_ACCOUNT_SECRETS_KEY`

### MySQL
- `DB_HOST`
- `DB_PORT`
- `DB_USERNAME`
- `DB_PASSWORD`
- `DB_NAME`

### PostgreSQL
- `PG_DB_ENABLED`
- `PG_DB_HOST`
- `PG_DB_PORT`
- `PG_DB_USERNAME`
- `PG_DB_PASSWORD`
- `PG_DB_NAME`
- `PG_DB_SSL`

## Frontend

Repo:
- `../../Frontend/aurAlphaApp`

Reference file:
- `../../Frontend/aurAlphaApp/environment/production/.env.example`

Required:
- `APP_ENV=production`
- `PORT`
- `API_BASE_URL`
- `API_KEY`
- `DISCOVERY_API_BASE_URL`
- `DISCOVERY_WS_URL`

Optional:
- `APP_API_TIMEOUT_MS`

## Required production invariants

Do not deploy with:
- `AUTH_SEED_ENABLED=true`
- `DB_SYNCHRONIZE=true`
- `REDIS_AUTO_START=true`
- missing `SCHEDULER_WORKER_BASE_URL`
- missing `ACTIVITY_EXPORT_STORAGE_DIR`
- frontend `API_BASE_URL` or discovery URLs left blank

## Secrets handling

Do not commit:
- real `.env` files
- broker credentials
- JWT secrets
- database passwords
- Redis passwords

Set secrets through:
- host environment
- deployment secret manager
- or protected env files on the target host
