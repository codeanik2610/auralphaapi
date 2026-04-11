# Login Phase 3 Baseline

Phase 3 hardens the backend auth system so Phase 4 can focus on user-facing trust and account controls instead of backend prerequisites.

## Scope Completed

1. Added login throttling around `POST /api/v1/auth/login`.
2. Removed silent non-local fallbacks for critical auth/security secrets.
3. Disabled default auth seeding outside localhost unless explicitly re-enabled with custom values.
4. Added protected session-management endpoints backed by `refresh_tokens`.

## Runtime Decisions

- Frontend token storage stays on the existing local-storage model for now.
- Access-token TTL remains unchanged in Phase 3; there is still no access-token denylist.
- Login throttling uses an in-memory store:
  - `AUTH_LOGIN_MAX_ATTEMPTS=5`
  - `AUTH_LOGIN_IP_MAX_ATTEMPTS=20`
  - `AUTH_LOGIN_WINDOW_MINUTES=15`
  - `AUTH_LOGIN_LOCKOUT_MINUTES=15`
- This is good enough for localhost/single-instance rollout hardening.
- Multi-instance production rollout should move login-throttle state into Redis or another shared store.

## New Protected Endpoints

- `GET /api/v1/auth/sessions`
  - returns active refresh-token sessions for the authenticated user
  - includes `id`, `userAgent`, `ipAddress`, `createdAt`, and `expiresAt`
- `POST /api/v1/auth/logout-all`
  - revokes all active refresh tokens for the authenticated user
  - returns `{ revoked: true, count }`

## Environment Rules

- On localhost:
  - `AUTH_SEED_ENABLED` defaults to `true`
  - default seed user remains `admin@auralpha.com / Admin@123`
- Outside localhost:
  - `AUTH_SEED_ENABLED` defaults to `false`
  - if enabled, `AUTH_SEED_EMAIL`, `AUTH_SEED_PASSWORD`, and `AUTH_SEED_FULL_NAME` must be set explicitly
  - `AUTH_ACCESS_TOKEN_SECRET` must not use the local fallback
  - `DISCOVERY_SCHEDULER_SECRET` must not use the local fallback
  - `BROKER_ACCOUNT_SECRETS_KEY` must not use the local fallback
  - `APP_API_KEY` must be explicitly set when `APP_REQUIRE_API_KEY=true`

## Residual Risks Carried Into Phase 4

- `logout` and `logout-all` revoke refresh tokens only; already-issued access tokens remain valid until expiry.
- Session listings are refresh-token based, so “current session” labeling still needs frontend logic.
- Login throttling is not yet shared across multiple API instances.

## Phase 4 Ready Surface

Phase 4 can now build directly on:

- `GET /auth/me`
- `GET /auth/sessions`
- `POST /auth/logout`
- `POST /auth/logout-all`

That means Phase 4 can focus on:

- session history UI
- last-login trust cues
- logout-all UX
- account/session management affordances
