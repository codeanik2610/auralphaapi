# Discovery Dependency Contract

This document defines the external discovery-engine contract that aurAlpha depends on for
`/discovery`, plus the normalized dependency-health surface that aurAlpha now exposes for
operators.

## Ownership Boundary

Discovery is intentionally split across two services. Production signoff depends on both halves
being owned explicitly instead of relying on implied tribal knowledge.

aurAlpha owns:

- `/discovery` workspace UI in `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.jsx`
- bearer-token forwarding from aurAlpha into discovery-engine
- normalized operator surfaces:
  - `GET /api/v1/health/discovery`
  - `GET /api/v1/discovery/summary`
  - `GET /api/v1/discovery/feed`
- discovery scheduler bridge, callback reconciliation, activity logging, and failure alerting
- release gates and smokes in this repo:
  - `npm run smoke:discovery-dependency`
  - `npm run smoke:discovery-contract`
  - `npm run release-gate:discovery`

discovery-engine owns:

- canonical Discovery domain data and APIs for:
  - bots
  - strategies
  - runs
  - template suggestions
  - preferences
- discovery-engine database migrations, retention, backup, and restore for its Postgres store
- discovery-engine realtime websocket stream used by the Discovery live feed
- discovery bot execution semantics, concurrency limits, and exchange/data-provider integrations

Operational expectation:

- aurAlpha can only claim Discovery is release-ready when both the aurAlpha wrapper surfaces and the
  discovery-engine dependency contract are green on the target stack
- if discovery-engine changes a payload shape, auth behavior, or base URL policy, this document and
  the aurAlpha smokes must be updated in the same rollout window

## External Base URL

- Environment variable: `DISCOVERY_API_BASE_URL`
- Default: `http://localhost:8000/api/v1/discovery`
- Expected shape: fully qualified `http(s)` base URL pointing at the discovery-engine API root

## External Discovery-Engine Health Probes

aurAlpha expects discovery-engine to expose:

- `GET /health`
  - Expected minimum payload:
    - `status: "ok"`
    - `service: "discovery-engine"`
- `GET /health/ready`
  - Expected minimum payload:
    - `status: "ok"` or `status: "degraded"`
    - `dependencies.postgres.status`
    - `dependencies.mysql.status`
    - `dependencies.redis.status`

## Authenticated Discovery-Engine Endpoints Used By aurAlpha

aurAlpha forwards the logged-in bearer token to discovery-engine and depends on these endpoint
shapes remaining stable:

- `GET /bots?limit=1&offset=0`
  - Expected payload: object with `items` array and finite `total`
- sampled `GET /bots/{botId}`
  - sampled from the first authenticated bots list row when available
  - Expected payload:
    - `id` matches the sampled bot id
    - `name` non-empty string
    - `status` non-empty string
- `GET /runs?limit=1&offset=0`
  - Expected payload: object with `items` array and finite `total`
- sampled `GET /runs/{runId}`
  - sampled from the first authenticated runs list row when available
  - Expected payload:
    - `id` matches the sampled run id
    - `status` non-empty string
- `GET /strategies?limit=1&offset=0`
  - Expected payload: object with `items` array and finite `total`
- sampled `GET /strategies/{strategyId}`
  - sampled from the first authenticated strategies list row when available
  - Expected payload:
    - `id` matches the sampled strategy id
    - `name` non-empty string
    - `status` non-empty string
- `GET /template-suggestions?limit=1&offset=0`
  - Expected payload: object with `items` array and finite `total`
- `GET /preferences`
  - Expected payload:
    - `preferred_timeframes` array
    - `risk_tolerance` non-empty string
    - `auto_backtest_approved` boolean

## aurAlpha Dependency Health Surface

aurAlpha now exposes:

- `GET /api/v1/health/discovery`
- `GET /api/v1/discovery/feed`
- `GET /api/v1/discovery/summary`

Behavior:

- Requires authenticated user context
- Forwards the request bearer token to discovery-engine
- Probes discovery-engine service health, readiness, auth bridge, and the endpoint contract above
- Returns a normalized payload with:
  - `status`
  - `checkedAt`
  - `baseUrl`
  - `service`
  - `readiness`
  - `auth`
  - `contract`
  - `endpoints`
  - optional `detail`

Endpoint probe metadata:

- direct list/preference probes expose `probeMode: "direct"`
- sampled by-id probes expose `probeMode: "sampled"` plus `sampledId`
- when aurAlpha cannot sample a detail endpoint because the corresponding list is empty, the
  detail check remains `status: "ok"` with `probeMode: "skipped"` and an explanatory `detail`
- the Discovery workspace uses these probes section by section to mark capabilities as ready,
  stale, unavailable, or unknown, and to disable write actions when the relevant dependency seam
  is explicitly `down`

Status meaning:

- `ok`
  - discovery-engine is healthy, ready, accepts the forwarded aurAlpha token, and the checked
    endpoint shapes match the contract aurAlpha depends on
- `degraded`
  - discovery-engine is reachable and auth works, but readiness or one or more contract checks are
    unhealthy
- `down`
  - discovery-engine health or auth bridge is unavailable, or aurAlpha cannot reach the dependency

## aurAlpha Discovery Summary Surface

aurAlpha also exposes:

- `GET /api/v1/discovery/summary`

Behavior:

- Requires authenticated user context
- Forwards the request bearer token to discovery-engine
- Computes an authoritative Discovery workspace summary from discovery-engine list contracts:
  - bots total plus exact active-bot count
  - total discovered strategies
  - pending-review strategy count
  - best strategy score
  - template suggestion total
  - run total

Response shape:

- `checkedAt`
- `bots.total`
- `bots.active`
- `strategies.total`
- `strategies.pendingReview`
- `strategies.bestScore`
- `suggestions.total`
- `runs.total`

Implementation note:

- discovery-engine does not currently expose a direct active-bot summary endpoint, so aurAlpha computes
  `bots.active` by paging the authenticated `/bots` list and counting `status=running`

## aurAlpha Discovery Feed Surface

aurAlpha also exposes:

- `GET /api/v1/discovery/feed`

Query parameters:

- `limit`
  - optional
  - default `20`
  - clamped to `1..100`
- `botId`
  - optional
  - forwards an authenticated `bot_id` filter to discovery-engine `/runs`

Behavior:

- Requires authenticated user context
- Forwards the request bearer token to discovery-engine
- Uses the authenticated discovery-engine `/runs` list as the durable initial history source for
  the Discovery live-feed panel
- Normalizes recent runs into feed entries with:
  - `id`
  - `source`
  - `type`
  - `occurredAt`
  - `runId`
  - `botId`
  - `status`
  - `strategiesFound`
  - `assetsScanned`
  - `durationSeconds`
  - `startedAt`
  - `completedAt`
  - `errorMessage`
  - `timeframes`
  - `assets`

Implementation note:

- This is a durable run-history projection, not a full replayable event log
- aurAlpha still relies on discovery-engine WebSocket events for realtime `strategy_discovered`
  updates

## Discovery WebSocket Resolution

aurAlpha frontend now derives the Discovery WebSocket URL from the same configured discovery base
used for REST calls whenever `discoveryApiBaseUrl` is present.

Resolution order:

- explicit `discoveryWsUrl` config, if provided
- derived `ws(s)://<discovery-host>/ws/discovery` from `discoveryApiBaseUrl`
- fallback `DISCOVERY_WS_URL`

## Operator Smoke

aurAlpha includes a dependency smoke:

- `npm run smoke:discovery-dependency`

The smoke:

- logs into aurAlpha
- calls `GET /api/v1/health/discovery`
- asserts:
  - overall dependency `status` is `ok`
  - service/readiness/auth/contract are all `ok`
  - readiness dependencies for Postgres, MySQL, and Redis are `ok`
  - the checked discovery-engine endpoints all pass contract validation

aurAlpha also includes a wider authenticated contract smoke:

- `npm run smoke:discovery-contract`

The contract smoke:

- logs into aurAlpha
- verifies the aurAlpha-owned wrapper surfaces:
  - `GET /api/v1/health/discovery`
  - `GET /api/v1/discovery/summary`
  - `GET /api/v1/discovery/feed`
- uses the aurAlpha bearer token directly against discovery-engine to verify:
  - preferences
  - bots list plus temporary bot create/read/update/delete
  - sampled strategy detail
  - sampled run detail
  - template suggestion list
- optionally replays an already-imported suggestion as an idempotent import contract check
- optionally runs temporary bot start/stop if `DISCOVERY_CONTRACT_SMOKE_RUN_BOT_LIFECYCLE=true`

Release gate:

- `npm run release-gate:discovery`
- writes `artifacts/discovery-release-gate.json` by default
- runs both discovery smokes by default, then re-reads:
  - `GET /api/v1/health/discovery`
  - `GET /api/v1/discovery/summary`
  - `GET /api/v1/discovery/feed`
- records the final dependency status, contract status, summary totals, and feed history count

## Failure Interpretation

- `service=down`
  - discovery-engine process or base URL is unreachable, or `/health` no longer matches the expected
    service payload
- `readiness=degraded|down`
  - discovery-engine is up but one or more of its dependencies are not fully healthy
- `auth=down`
  - aurAlpha bearer tokens are no longer accepted by discovery-engine
- `contract=down`
  - discovery-engine is reachable, but one or more endpoints no longer match the payload shapes that
    `/discovery` depends on
