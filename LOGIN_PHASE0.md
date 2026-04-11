# Login & Session Phase 0

Date: 2026-04-09

## 1) Problem Statement
AurAlpha already has working backend authentication and a real frontend `/login` route, but the
end-to-end behavior is split across two repositories and is easy to misread as "just a login page."
Phase 0 exists to freeze the ownership boundary, session contract, token-storage decision, and
success metrics before Phase 1 changes the user experience.

## 2) Ownership Boundary
Frontend ownership lives in `/Users/apple/Documents/Project/Frontend/aurAlphaApp`:

- route registration: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`
- login page UI: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Login/index.jsx`
- auth state orchestration: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/authSlice.js`
- session persistence: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/helpers/authStorage.js`
- authenticated request + refresh behavior:
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/http.js`

Backend ownership lives in this repo:

- auth controller: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/AuthController.ts`
- auth service: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AuthService.ts`
- auth validation: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/auth.validator.ts`
- auth middleware: `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/middlewares/ApiKeyMiddleware.ts`
- auth DB bootstrap: `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/migrations/1741480000000-CreateAuthTables.ts`

Phase 1 may change the frontend experience, but it must preserve the backend contract documented
below unless both repos are changed together.

## 3) Current End-To-End Data Flow
1. The user lands on `/login`.
2. The frontend login page validates `email` and `password` locally, then dispatches
   `loginUser(credentials)`.
3. The frontend sends `POST /api/v1/auth/login` with JSON body:
   `{ "email": "...", "password": "..." }`.
4. The backend:
   - normalizes the email
   - reads the `users` row by email
   - compares the bcrypt password hash
   - updates `users.last_login_at`
   - creates a `refresh_tokens` row with a SHA-256 token hash
   - returns `{ accessToken, refreshToken, user }`
5. The frontend stores the returned session in local storage under `auralpha-auth-session`.
6. Protected API requests send `Authorization: Bearer <accessToken>`.
7. On a protected-route `401`, the frontend performs one in-flight refresh against
   `POST /api/v1/auth/refresh`.
8. If refresh succeeds, the frontend updates local storage and retries the failed request once.
9. If refresh fails, the frontend clears local storage and redirects the browser to `/login`.
10. Logout calls `POST /api/v1/auth/logout` with the current refresh token and clears local state.

## 4) Frozen Backend Contract
All responses below are part of the Phase 0 baseline for Phase 1 frontend work.

### `POST /api/v1/auth/login`
Request body:

```json
{
  "email": "admin@auralpha.com",
  "password": "Admin@123"
}
```

Success response:

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<opaque-token>",
    "user": {
      "id": "<uuid>",
      "email": "admin@auralpha.com",
      "fullName": "AurAlpha Admin",
      "role": "Admin",
      "status": "active",
      "lastLoginAt": "2026-04-09T08:00:00.000Z"
    }
  }
}
```

Expected client-visible failures:

- `400` with `message: "A valid email is required"`
- `400` with `message: "Password is required"`
- `401` with `message: "Invalid email or password"`

### `POST /api/v1/auth/refresh`
Request body:

```json
{
  "refreshToken": "<opaque-token>"
}
```

Success response shape:

- same as `/auth/login`
- rotates the refresh token
- revokes the previous refresh token row

Expected client-visible failures:

- `400` with `message: "refreshToken is required"`
- `401` with `message: "Refresh token is invalid or expired"`

### `GET /api/v1/auth/me`
Headers:

```text
Authorization: Bearer <accessToken>
```

Success response:

```json
{
  "success": true,
  "data": {
    "id": "<uuid>",
    "email": "admin@auralpha.com",
    "fullName": "AurAlpha Admin",
    "role": "Admin",
    "status": "active",
    "lastLoginAt": "2026-04-09T08:00:00.000Z"
  }
}
```

Expected client-visible failure:

- `401` with `message: "Unauthorized"` or `message: "Authentication required"` depending on call path

### `POST /api/v1/auth/logout`
Request body:

```json
{
  "refreshToken": "<opaque-token>"
}
```

Success response:

```json
{
  "success": true,
  "data": {
    "revoked": true
  }
}
```

Expected client-visible failure:

- `400` with `message: "refreshToken is required"`

### Error Envelope
Non-2xx responses use this JSON shape:

```json
{
  "statusCode": 401,
  "message": "Invalid email or password",
  "timestamp": "2026-04-09T08:00:00.000Z",
  "path": "/api/v1/auth/login"
}
```

## 5) Phase 0 Decisions
### Session Storage Strategy
Decision:

- Keep the current bearer-token + JSON refresh-token contract for Phase 1.
- Keep the current local-storage session persistence model for Phase 1.
- Do not switch to cookie-based auth during Phase 1 UI work.

Reason:

- both repos already implement this model end to end
- the refresh flow is already coded in the frontend HTTP layer
- switching to cookies now would widen scope from UX iteration into auth-platform migration

Follow-up:

- revisit cookie-based HTTP-only refresh storage in a later hardening phase

### Redirect Strategy
Decision:

- `/login` remains the only public entry route for the main app shell
- successful login navigates to the requested protected route or `/overview`
- refresh failure redirects to `/login`

### Phase 1 Scope Guardrails
In scope for Phase 1:

- login page UX and accessibility improvements
- better loading, error, and redirect handling
- route-entry polish
- clearer session-state transitions

Out of scope for Phase 1:

- SSO
- MFA
- password reset
- cookie migration
- auth schema redesign

## 6) Current Known Gaps
- The frontend "Remember me" checkbox is currently cosmetic; session persistence is always local
  storage-backed.
- The backend has no login rate limiting or brute-force protection yet.
- Refresh tokens live in browser local storage, which increases XSS sensitivity.
- Logout revokes the refresh token but does not invalidate already-issued access tokens before
  expiry.
- Local bootstrap still falls back to a default admin seed account and default auth secret when env
  values are not overridden.

These gaps do not block Phase 1 UX work, but they must stay visible so UX polish does not get
mistaken for auth hardening.

## 7) Success Metrics
Phase 1 should measure against these metrics, even if not every signal is fully instrumented on day
one.

Primary:

- login success rate
  - definition: successful `/auth/login` responses divided by total submitted login attempts
- median login time to protected-route paint
  - definition: submit click to first successful protected-route render
- refresh success rate
  - definition: successful `/auth/refresh` responses divided by attempted refreshes
- unexpected session drop rate
  - definition: redirects to `/login` triggered by refresh failure or auth loss while the user was
    previously authenticated

Secondary:

- field-validation failure rate on `/login`
- credential failure rate (`401 Invalid email or password`)
- network/server failure rate on `/login`
- median time from app boot to restored authenticated session

Suggested measurement points:

- frontend:
  - login form submit
  - login success
  - login failure by class: validation, `401`, timeout, network, `5xx`
  - refresh success
  - refresh failure
  - redirect-to-login due to auth loss
- backend:
  - request volume and status split for `/api/v1/auth/login`, `/refresh`, `/logout`, `/me`
  - `users.last_login_at` freshness
  - refresh token issuance and revocation counts

## 8) Phase 0 Deliverables In This Repo
- this document freezes the ownership boundary and auth/session baseline
- `npm run test:auth-contract` provides executable contract checks for the backend auth flow
- the backend README points to this Phase 0 baseline for future frontend work

## 9) Phase 0 Exit Criteria
Phase 0 is complete when all of the following are true:

- the real frontend `/login` owner is identified
- the request/response/error contract is frozen in writing
- the session-storage decision is explicit
- success metrics are defined
- backend auth behavior has executable contract coverage

This repo now satisfies those criteria for the current bearer-token architecture.
