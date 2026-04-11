# Orders Phase 8

Phase 8 closes the last two open mutation-hardening items for `/orders`:

- create-order submit idempotency
- normalized broker rejection errors

## 1) What Changed

Backend hardening:

- `POST /api/v1/orders/futures/:assetId` now accepts optional `idempotency_key` in [orders.validator.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/orders.validator.ts)
- create-order requests are persisted in the new `order_submission_requests` ledger via [OrderSubmissionRequest.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/OrderSubmissionRequest.ts), [OrderSubmissionRequestRepository.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/OrderSubmissionRequestRepository.ts), and [1770702000000-CreateOrderSubmissionRequests.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/database/migrations/1770702000000-CreateOrderSubmissionRequests.ts)
- [BrokerOrdersFacadeService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerOrdersFacadeService.ts) now:
  - hashes normalized create-order drafts after route resolution and risk checks
  - replays previously completed submissions for the same user + key + draft
  - blocks key reuse across different drafts with `ORDER_IDEMPOTENCY_KEY_REUSED`
  - exposes in-flight collisions as `ORDER_SUBMISSION_IN_PROGRESS`
  - normalizes broker rejection reasons like insufficient margin, invalid price, invalid quantity, invalid leverage, duplicate submission, timeout, and broker unavailability
  - treats post-create follow-up work as best-effort so a successful create is less likely to be masked by non-critical linking/logging failures
- API errors now carry optional machine-readable `code` values via [AppError.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/errors/AppError.ts), [ApiResponse.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/ApiResponse.ts), and [ErrorHandlerMiddleware.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/middlewares/ErrorHandlerMiddleware.ts)

Frontend wiring:

- [http.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/http.js) now preserves backend `code` values on thrown request errors
- [ordersSlice.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.js) now stores `actionErrorCode` and `actionErrorStatus`
- [trust.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/trust.js) now manages ticket-scoped submit keys and maps normalized error codes to operator hints
- [index.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx) now sends `idempotency_key` with create-order mutations and clears the saved key after success
- [OrderCreateDrawer.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrderCreateDrawer.jsx) now shows targeted guidance for normalized create-order failures

## 2) Contract Truth

The `/orders/overview` metadata is now updated to the Phase 8 truth in:

- [OrdersOverview.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/OrdersOverview.ts)
- [OrdersOverviewService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersOverviewService.ts)

New Phase 8 metadata now advertises:

- `sources.createSubmissionLedger = order_submission_requests`
- `pageTruth.createMutationHardening = server_idempotency_keys_and_normalized_rejections`
- `capabilities.createSubmitIdempotency = true`
- `capabilities.normalizedBrokerRejectCodes = true`

## 3) Verification

Phase 8 verification passed with:

- `npm run test:orders-contract`
- `npm run test:orders-phase8`
- `npx eslint src/api/contracts/ApiResponse.ts src/api/errors/AppError.ts src/api/middlewares/ErrorHandlerMiddleware.ts src/api/contracts/OrdersOverview.ts src/api/services/OrdersOverviewService.ts src/api/services/BrokerOrdersFacadeService.ts src/api/validators/orders.validator.ts src/database/entities/OrderSubmissionRequest.ts src/database/repositories/OrderSubmissionRequestRepository.ts scripts/test-orders-contract.ts scripts/test-orders-phase8.ts`
- `npm run type-check`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Orders/index.test.jsx src/store/slices/ordersSlice.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Orders/index.jsx src/pages/Orders/OrderCreateDrawer.jsx src/pages/Orders/trust.js src/pages/Orders/index.test.jsx src/store/slices/ordersSlice.js src/store/slices/ordersSlice.test.js src/services/http.js tests/e2e/orders.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/orders.spec.js`

## 4) Outcome

`/orders` no longer depends only on button disabling to avoid duplicate submit. The create path is now protected end to end:

- the frontend reuses the same submit key for the same ticket draft
- the backend persists and replays completed submissions
- the UI now receives stable error codes and friendlier failure copy instead of raw broker/provider text

This closes the last open `/orders` items that were still pending after Phase 7.
