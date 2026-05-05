-- =============================================================================
-- Diagnose why automation orders only land on Mudrex (not Delta)
-- DB: MySQL (coreDataSource)
-- Tables: suggested_trades, suggested_trade_executions, broker_accounts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Latest suggestions + which broker was actually selected, plus per-candidate
--    support reasons. This is the most useful single query.
--    Adjust the time window in the WHERE clause (default: last 24h).
-- -----------------------------------------------------------------------------
SELECT
  st.id                                                     AS suggested_trade_id,
  st.symbol,
  st.timeframe,
  st.side,
  st.signal_time,
  st.status,
  ste.execution_mode,
  ste.execution_state,
  ste.broker_key                                            AS executed_broker,
  ste.account_id                                            AS executed_account,
  ste.order_id,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.mode'))            AS route_mode,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.decision'))        AS route_decision,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.selectedBrokerKey')) AS selected_broker,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.selectedAccountName')) AS selected_account,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.summary'))         AS route_summary,
  JSON_EXTRACT(st.meta_json, '$.routeDecision.candidates')                    AS candidates_json
FROM suggested_trades st
LEFT JOIN suggested_trade_executions ste ON ste.suggested_trade_id = st.id
WHERE st.created_at >= NOW() - INTERVAL 1 DAY
ORDER BY st.created_at DESC
LIMIT 50;

-- -----------------------------------------------------------------------------
-- 2) Per-candidate flatten: one row per (suggestion, candidate broker).
--    Shows EXACTLY why each broker (mudrex / delta_exchange) was supported or
--    rejected on each suggestion. This is what you actually want to read.
-- -----------------------------------------------------------------------------
WITH RECURSIVE idx(i) AS (
  SELECT 0
  UNION ALL
  SELECT i + 1 FROM idx WHERE i < 9   -- supports up to 10 candidates per trade
)
SELECT
  st.id                                                     AS suggested_trade_id,
  st.symbol,
  st.timeframe,
  st.signal_time,
  i.i                                                       AS candidate_index,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].brokerKey')))    AS broker_key,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].accountName'))) AS account_name,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].brokerSymbol'))) AS broker_symbol,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].resolvedVia')))  AS resolved_via,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].supported')))    AS supported,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].supportMessage'))) AS support_message,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].allowed')))      AS allowed,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].blocked')))      AS blocked,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].summary')))      AS candidate_summary
FROM suggested_trades st
JOIN idx i
WHERE st.created_at >= NOW() - INTERVAL 1 DAY
  AND JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, ']')) IS NOT NULL
ORDER BY st.created_at DESC, i.i;

-- -----------------------------------------------------------------------------
-- 3) Just the Delta-rejection reasons (most likely what you actually want).
-- -----------------------------------------------------------------------------
WITH RECURSIVE idx(i) AS (
  SELECT 0 UNION ALL SELECT i + 1 FROM idx WHERE i < 9
)
SELECT
  st.id              AS suggested_trade_id,
  st.symbol,
  st.timeframe,
  st.signal_time,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].supportMessage'))) AS delta_reject_reason,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].summary')))        AS delta_summary,
  JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.selectedBrokerKey'))                            AS chosen_broker
FROM suggested_trades st
JOIN idx i
WHERE st.created_at >= NOW() - INTERVAL 7 DAY
  AND JSON_UNQUOTE(JSON_EXTRACT(
        st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].brokerKey')
      )) = 'delta_exchange'
  AND JSON_UNQUOTE(JSON_EXTRACT(
        st.meta_json, CONCAT('$.routeDecision.candidates[', i.i, '].supported')
      )) = 'false'
ORDER BY st.signal_time DESC
LIMIT 50;

-- -----------------------------------------------------------------------------
-- 4) Connected broker accounts: are Delta accounts actually present and default?
--    If isDefault is 0 on Delta and 1 on Mudrex, the route gate filters Delta
--    out before evaluation (SuggestedTradesService.listDefaultRouteCandidates).
-- -----------------------------------------------------------------------------
SELECT
  ba.id,
  ba.user_id,
  ba.broker_key,
  ba.account_name,
  ba.account_key,
  ba.is_default,
  ba.is_connected,
  ba.created_at
FROM broker_accounts ba
WHERE ba.broker_key IN ('mudrex', 'delta_exchange')
ORDER BY ba.user_id, ba.broker_key;

-- -----------------------------------------------------------------------------
-- 5) Catalog check: does the symbol have an externalId on Delta?
--    Delta REQUIRES the catalog entry; Mudrex falls back. Replace BTCUSDT.
-- -----------------------------------------------------------------------------
SELECT source, symbol, external_id, base_currency, quote_currency, updated_at
FROM exchange_assets
WHERE source IN ('mudrex', 'delta_exchange')
  AND symbol IN ('BTCUSDT', 'BTCUSDC', 'BTCUSD')
ORDER BY source, symbol;

-- =============================================================================
-- POSITION <-> ORDER LINKAGE AUDIT
-- "Does every open live position have a supporting order in DB?"
-- Answer: only positions opened via suggested_trade_executions are tracked.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 6) Summary counts: open live positions, of which linked vs orphan.
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*)                                                             AS open_positions_total,
  SUM(CASE WHEN ste.suggested_trade_id IS NOT NULL THEN 1 ELSE 0 END)  AS linked_to_execution,
  SUM(CASE WHEN ste.suggested_trade_id IS NULL     THEN 1 ELSE 0 END)  AS orphan_no_execution,
  SUM(CASE WHEN ste.suggested_trade_id IS NOT NULL
            AND ste.order_id IS NOT NULL THEN 1 ELSE 0 END)            AS linked_with_order_id,
  SUM(CASE WHEN ste.suggested_trade_id IS NOT NULL
            AND ste.order_id IS NULL     THEN 1 ELSE 0 END)            AS linked_but_no_order_id
FROM position_read_models prm
LEFT JOIN suggested_trade_executions ste
       ON ste.user_id    = prm.user_id
      AND ste.account_id = prm.account_id
      AND ste.broker_key = prm.broker_key
      AND ste.position_id = prm.external_id
WHERE prm.status_rank > 0          -- open (1=open, 2=partially open per conflict query)
  AND prm.quantity IS NOT NULL
  AND ABS(prm.quantity) > 0;

-- -----------------------------------------------------------------------------
-- 7) The orphan list: open positions with NO suggested_trade_executions row.
--    These were opened outside the platform (manual UI / external bot / API).
-- -----------------------------------------------------------------------------
SELECT
  prm.user_id,
  prm.broker_key,
  prm.account_id,
  prm.external_id                AS position_id,
  prm.symbol,
  prm.side,
  prm.quantity,
  prm.entry_price,
  prm.position_created_at,
  prm.last_seen_at
FROM position_read_models prm
LEFT JOIN suggested_trade_executions ste
       ON ste.user_id    = prm.user_id
      AND ste.account_id = prm.account_id
      AND ste.broker_key = prm.broker_key
      AND ste.position_id = prm.external_id
WHERE prm.status_rank > 0
  AND prm.quantity IS NOT NULL
  AND ABS(prm.quantity) > 0
  AND ste.suggested_trade_id IS NULL
ORDER BY prm.last_seen_at DESC
LIMIT 100;

-- -----------------------------------------------------------------------------
-- 8) The linked list: open positions WITH a backing execution and order_id,
--    plus the originating suggested trade.
-- -----------------------------------------------------------------------------
SELECT
  prm.user_id,
  prm.broker_key,
  prm.account_id,
  prm.external_id           AS position_id,
  prm.symbol,
  prm.side,
  prm.quantity,
  ste.suggested_trade_id,
  ste.order_id,
  ste.order_status,
  ste.execution_state,
  ste.submitted_at,
  ste.filled_at,
  st.automation_id,
  st.automation_run_id
FROM position_read_models prm
JOIN suggested_trade_executions ste
       ON ste.user_id    = prm.user_id
      AND ste.account_id = prm.account_id
      AND ste.broker_key = prm.broker_key
      AND ste.position_id = prm.external_id
LEFT JOIN suggested_trades st ON st.id = ste.suggested_trade_id
WHERE prm.status_rank > 0
  AND prm.quantity IS NOT NULL
  AND ABS(prm.quantity) > 0
ORDER BY prm.last_seen_at DESC
LIMIT 100;

-- -----------------------------------------------------------------------------
-- 9) Paper trading: paper_positions vs paper_orders. UNIQUE constraint on
--    paper_order_id means every paper position MUST have a paper_orders row.
--    This query just verifies that invariant (should always return 0).
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS paper_positions_missing_order
FROM paper_position_read_models pprm
LEFT JOIN paper_orders po ON po.id = pprm.paper_order_id
WHERE pprm.status_key IN ('open', 'opening', 'partially_open')
  AND po.id IS NULL;
