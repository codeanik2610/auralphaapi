#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${BASH_SOURCE[0]:-}" && "${BASH_SOURCE[0]}" != "bash" ]]; then
  SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"
else
  SCRIPT_DIR="$(pwd)"
  ROOT_DIR="${SCRIPT_DIR}"
fi

MODE="dry-run"
CANDLE_RETENTION_DAYS=90
EXCHANGE_LOG_KEEP_RUNS=5
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-auralpha-postgres-1}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-auralpha-mysql-1}"
POSTGRES_DB="${POSTGRES_DB:-auralpha}"
POSTGRES_USER="${POSTGRES_USER:-auralpha}"
MYSQL_DATABASE="${MYSQL_DATABASE:-auralpha}"
POSTGRES_BATCH_SIZE=50000
MYSQL_BATCH_SIZE=50000
MAX_BATCHES=200
DOCKER_BUILDER_UNTIL="72h"
RUN_DOCKER_PRUNE=true
RUN_DB_VACUUM=true
EXACT_CANDLE_COUNT=false
RUN_POSTGRES_CANDLES=true
RUN_MYSQL_EXCHANGE_LOGS=true

function usage() {
  cat <<'USAGE'
Usage:
  scripts/maintenance/platform-retention.sh [--dry-run|--apply] [options]

Purpose:
  Retain only production-safe operational data windows:
  - Postgres market_candles_1m: keep last 90 days by open_time.
  - MySQL exchange_asset_update_logs: keep logs for the latest 5 runs per scheduler/user scope.
  - Docker build cache: prune old build cache only, never app images or volumes.

Safety:
  --dry-run is the default and never deletes data.
  --apply requires AURALPHA_RETENTION_CONFIRM=delete.

Options:
  --candle-retention-days DAYS       Default: 90
  --exchange-log-keep-runs COUNT     Default: 5
  --postgres-container NAME          Default: auralpha-postgres-1
  --mysql-container NAME             Default: auralpha-mysql-1
  --postgres-db NAME                 Default: auralpha
  --postgres-user NAME               Default: auralpha
  --mysql-database NAME              Default: auralpha
  --postgres-batch-size COUNT        Default: 50000
  --mysql-batch-size COUNT           Default: 50000
  --max-batches COUNT                Default: 200
  --docker-builder-until AGE         Default: 72h
  --skip-docker-prune                Do not prune Docker build cache in --apply.
  --skip-vacuum                      Do not run VACUUM ANALYZE after Postgres deletes.
  --skip-postgres-candles            Do not delete Postgres candle rows in --apply.
  --skip-mysql-exchange-logs         Do not delete MySQL exchange asset update logs in --apply.
  --exact-candle-count               Count old candle rows even without a leading open_time index.
  -h, --help                         Show this help.
USAGE
}

function fail() {
  echo "ERROR: $*" >&2
  exit 1
}

function section() {
  printf '\n== %s ==\n' "$1"
}

function require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    fail "Missing required command: ${name}"
  fi
}

function require_uint() {
  local name="$1"
  local value="$2"
  if [[ ! "${value}" =~ ^[1-9][0-9]*$ ]]; then
    fail "${name} must be a positive integer. Got: ${value}"
  fi
}

function require_safe_container_name() {
  local name="$1"
  local value="$2"
  if [[ ! "${value}" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    fail "${name} has unsafe characters. Got: ${value}"
  fi
}

function require_safe_identifier() {
  local name="$1"
  local value="$2"
  if [[ ! "${value}" =~ ^[A-Za-z0-9_]+$ ]]; then
    fail "${name} has unsafe characters. Got: ${value}"
  fi
}

function parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        MODE="dry-run"
        shift
        ;;
      --apply)
        MODE="apply"
        shift
        ;;
      --candle-retention-days)
        CANDLE_RETENTION_DAYS="${2:-}"
        shift 2
        ;;
      --exchange-log-keep-runs)
        EXCHANGE_LOG_KEEP_RUNS="${2:-}"
        shift 2
        ;;
      --postgres-container)
        POSTGRES_CONTAINER="${2:-}"
        shift 2
        ;;
      --mysql-container)
        MYSQL_CONTAINER="${2:-}"
        shift 2
        ;;
      --postgres-db)
        POSTGRES_DB="${2:-}"
        shift 2
        ;;
      --postgres-user)
        POSTGRES_USER="${2:-}"
        shift 2
        ;;
      --mysql-database)
        MYSQL_DATABASE="${2:-}"
        shift 2
        ;;
      --postgres-batch-size)
        POSTGRES_BATCH_SIZE="${2:-}"
        shift 2
        ;;
      --mysql-batch-size)
        MYSQL_BATCH_SIZE="${2:-}"
        shift 2
        ;;
      --max-batches)
        MAX_BATCHES="${2:-}"
        shift 2
        ;;
      --docker-builder-until)
        DOCKER_BUILDER_UNTIL="${2:-}"
        shift 2
        ;;
      --skip-docker-prune)
        RUN_DOCKER_PRUNE=false
        shift
        ;;
      --skip-vacuum)
        RUN_DB_VACUUM=false
        shift
        ;;
      --skip-postgres-candles)
        RUN_POSTGRES_CANDLES=false
        shift
        ;;
      --skip-mysql-exchange-logs)
        RUN_MYSQL_EXCHANGE_LOGS=false
        shift
        ;;
      --exact-candle-count)
        EXACT_CANDLE_COUNT=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

function validate_inputs() {
  require_uint "CANDLE_RETENTION_DAYS" "${CANDLE_RETENTION_DAYS}"
  require_uint "EXCHANGE_LOG_KEEP_RUNS" "${EXCHANGE_LOG_KEEP_RUNS}"
  require_uint "POSTGRES_BATCH_SIZE" "${POSTGRES_BATCH_SIZE}"
  require_uint "MYSQL_BATCH_SIZE" "${MYSQL_BATCH_SIZE}"
  require_uint "MAX_BATCHES" "${MAX_BATCHES}"
  require_safe_container_name "POSTGRES_CONTAINER" "${POSTGRES_CONTAINER}"
  require_safe_container_name "MYSQL_CONTAINER" "${MYSQL_CONTAINER}"
  require_safe_identifier "POSTGRES_DB" "${POSTGRES_DB}"
  require_safe_identifier "POSTGRES_USER" "${POSTGRES_USER}"
  require_safe_identifier "MYSQL_DATABASE" "${MYSQL_DATABASE}"

  if [[ "${MODE}" == "apply" && "${AURALPHA_RETENTION_CONFIRM:-}" != "delete" ]]; then
    fail "--apply requires AURALPHA_RETENTION_CONFIRM=delete"
  fi
}

function postgres_query() {
  local sql="$1"
  docker exec -i \
    -e POSTGRES_USER="${POSTGRES_USER}" \
    -e POSTGRES_DB="${POSTGRES_DB}" \
    "${POSTGRES_CONTAINER}" \
    sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq' \
    <<<"${sql}"
}

function mysql_query() {
  local sql="$1"
  docker exec -i \
    -e MYSQL_DATABASE="${MYSQL_DATABASE}" \
    "${MYSQL_CONTAINER}" \
    sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --raw --skip-column-names "$MYSQL_DATABASE"' \
    <<<"${sql}"
}

function print_disk_snapshot() {
  df -h /
}

function print_docker_snapshot() {
  docker system df
}

function postgres_candle_cutoff_sql() {
  cat <<SQL
now() - make_interval(days => ${CANDLE_RETENTION_DAYS})
SQL
}

function postgres_has_leading_open_time_index() {
  postgres_query "
SELECT EXISTS (
  SELECT 1
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'market_candles_1m'
     AND indexdef ~* 'USING btree \\(open_time'
)::text;
"
}

function print_postgres_candle_report() {
  local cutoff_sql
  local has_leading_open_time_index
  cutoff_sql="$(postgres_candle_cutoff_sql)"
  has_leading_open_time_index="$(postgres_has_leading_open_time_index)"
  has_leading_open_time_index="${has_leading_open_time_index//$'\n'/}"

  postgres_query "
SELECT 'database' || chr(9) || current_database();
SELECT 'cutoff_open_time_utc' || chr(9) || (${cutoff_sql})::text;
SELECT 'table_size' || chr(9) || pg_size_pretty(pg_relation_size('public.market_candles_1m'));
SELECT 'index_size' || chr(9) || pg_size_pretty(pg_indexes_size('public.market_candles_1m'));
SELECT 'total_size' || chr(9) || pg_size_pretty(pg_total_relation_size('public.market_candles_1m'));
SELECT 'estimated_rows' || chr(9) || reltuples::bigint::text
  FROM pg_class
 WHERE oid = 'public.market_candles_1m'::regclass;
SELECT 'leading_open_time_index_exists' || chr(9) || '${has_leading_open_time_index}';
"

  if [[ "${has_leading_open_time_index}" != "t" && "${EXACT_CANDLE_COUNT}" != "true" ]]; then
    echo "oldest_open_time	skipped_no_leading_open_time_index"
    echo "newest_open_time	skipped_no_leading_open_time_index"
    echo "rows_older_than_retention	skipped_no_leading_open_time_index"
    echo "retention_note	create a leading open_time index before exact counts or apply deletes"
    return
  fi

  postgres_query "
SELECT 'oldest_open_time' || chr(9) || COALESCE(MIN(open_time)::text, 'none')
  FROM public.market_candles_1m;
SELECT 'newest_open_time' || chr(9) || COALESCE(MAX(open_time)::text, 'none')
  FROM public.market_candles_1m;
SELECT 'rows_older_than_retention' || chr(9) || COUNT(*)::text
  FROM public.market_candles_1m
 WHERE open_time < ${cutoff_sql};
"
}

function require_postgres_candle_delete_ready() {
  local has_leading_open_time_index
  has_leading_open_time_index="$(postgres_has_leading_open_time_index)"
  has_leading_open_time_index="${has_leading_open_time_index//$'\n'/}"
  if [[ "${has_leading_open_time_index}" != "t" ]]; then
    fail "Refusing market_candles_1m deletes without a leading open_time index. Add one first with CREATE INDEX CONCURRENTLY, then rerun."
  fi
}

function print_mysql_exchange_log_report() {
  echo "database	keep_runs_per_scheduler_user_scope	total_exchange_asset_update_logs	old_log_rows_outside_keep_window	old_run_ids_outside_keep_window	oldest_deletable_log_created_at	newest_deletable_log_created_at	exchange_asset_update_logs_mb"
  mysql_query "
WITH ranked_runs AS (
  SELECT
    id,
    scheduler_key,
    COALESCE(actor_user_id, '__global__') AS actor_scope,
    ROW_NUMBER() OVER (
      PARTITION BY scheduler_key, COALESCE(actor_user_id, '__global__')
      ORDER BY started_at DESC, created_at DESC, id DESC
    ) AS run_rank
  FROM scheduler_run_logs
),
old_logs AS (
  SELECT l.id, l.run_log_id, l.created_at
  FROM exchange_asset_update_logs l
  INNER JOIN ranked_runs r ON r.id = l.run_log_id
  WHERE r.run_rank > ${EXCHANGE_LOG_KEEP_RUNS}
)
SELECT
  DATABASE(),
  ${EXCHANGE_LOG_KEEP_RUNS},
  (SELECT COUNT(*) FROM exchange_asset_update_logs),
  COUNT(*),
  COUNT(DISTINCT run_log_id),
  COALESCE(CAST(MIN(created_at) AS CHAR), 'none'),
  COALESCE(CAST(MAX(created_at) AS CHAR), 'none'),
  (
    SELECT ROUND((data_length + index_length) / 1024 / 1024, 2)
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'exchange_asset_update_logs'
  )
FROM old_logs;
"
}

function print_mysql_binlog_report() {
  mysql_query "
SHOW BINARY LOGS;
" | awk '
  BEGIN { total = 0; count = 0 }
  NF >= 2 { count += 1; total += $2 }
  END {
    printf "binlog_count\t%d\n", count;
    printf "binlog_total_gb\t%.2f\n", total / 1024 / 1024 / 1024;
  }
'
}

function apply_postgres_candle_retention() {
  local cutoff_sql deleted total_deleted batch_number
  cutoff_sql="$(postgres_candle_cutoff_sql)"
  total_deleted=0
  batch_number=0

  while [[ "${batch_number}" -lt "${MAX_BATCHES}" ]]; do
    deleted="$(postgres_query "
WITH doomed AS (
  SELECT id
    FROM public.market_candles_1m
   WHERE open_time < ${cutoff_sql}
   LIMIT ${POSTGRES_BATCH_SIZE}
),
deleted AS (
  DELETE FROM public.market_candles_1m candle
   USING doomed
   WHERE candle.id = doomed.id
   RETURNING candle.id
)
SELECT COUNT(*) FROM deleted;
")"
    deleted="${deleted//$'\n'/}"
    deleted="${deleted:-0}"
    total_deleted=$((total_deleted + deleted))
    batch_number=$((batch_number + 1))
    echo "postgres_candles_deleted_batch_${batch_number}	${deleted}"
    if [[ "${deleted}" -eq 0 ]]; then
      break
    fi
  done

  echo "postgres_candles_deleted_total	${total_deleted}"

  if [[ "${RUN_DB_VACUUM}" == "true" && "${total_deleted}" -gt 0 ]]; then
    postgres_query "VACUUM ANALYZE public.market_candles_1m;"
    echo "postgres_market_candles_1m_vacuum_analyze	done"
  fi
}

function apply_mysql_exchange_log_retention() {
  local deleted total_deleted batch_number
  total_deleted=0
  batch_number=0

  while [[ "${batch_number}" -lt "${MAX_BATCHES}" ]]; do
    deleted="$(mysql_query "
SET sql_log_bin = 0;
DELETE l
FROM exchange_asset_update_logs l
INNER JOIN (
  SELECT id
  FROM (
    SELECT l2.id
    FROM exchange_asset_update_logs l2
    INNER JOIN (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY scheduler_key, COALESCE(actor_user_id, '__global__')
          ORDER BY started_at DESC, created_at DESC, id DESC
        ) AS run_rank
      FROM scheduler_run_logs
    ) ranked_runs ON ranked_runs.id = l2.run_log_id
    WHERE ranked_runs.run_rank > ${EXCHANGE_LOG_KEEP_RUNS}
  ) doomed_ids
  LIMIT ${MYSQL_BATCH_SIZE}
) doomed ON doomed.id = l.id;
SELECT ROW_COUNT();
")"
    deleted="$(printf '%s\n' "${deleted}" | tail -n 1)"
    deleted="${deleted//$'\n'/}"
    deleted="${deleted:-0}"
    total_deleted=$((total_deleted + deleted))
    batch_number=$((batch_number + 1))
    echo "mysql_exchange_asset_update_logs_deleted_batch_${batch_number}	${deleted}"
    if [[ "${deleted}" -eq 0 ]]; then
      break
    fi
  done

  echo "mysql_exchange_asset_update_logs_deleted_total	${total_deleted}"
}

function apply_docker_builder_prune() {
  if [[ "${RUN_DOCKER_PRUNE}" != "true" ]]; then
    echo "docker_builder_prune	skipped"
    return
  fi

  docker builder prune --force --filter "until=${DOCKER_BUILDER_UNTIL}"
}

function main() {
  parse_args "$@"
  validate_inputs
  require_command docker

  section "Retention Configuration"
  cat <<EOF
mode	${MODE}
root_dir	${ROOT_DIR}
candle_retention_days	${CANDLE_RETENTION_DAYS}
exchange_log_keep_runs	${EXCHANGE_LOG_KEEP_RUNS}
postgres_container	${POSTGRES_CONTAINER}
mysql_container	${MYSQL_CONTAINER}
postgres_batch_size	${POSTGRES_BATCH_SIZE}
mysql_batch_size	${MYSQL_BATCH_SIZE}
max_batches	${MAX_BATCHES}
docker_builder_until	${DOCKER_BUILDER_UNTIL}
run_postgres_candles	${RUN_POSTGRES_CANDLES}
run_mysql_exchange_logs	${RUN_MYSQL_EXCHANGE_LOGS}
run_docker_prune	${RUN_DOCKER_PRUNE}
EOF

  section "Disk Before"
  print_disk_snapshot

  section "Docker Usage Before"
  print_docker_snapshot

  section "Postgres market_candles_1m Retention Report"
  print_postgres_candle_report

  section "MySQL exchange_asset_update_logs Retention Report"
  print_mysql_exchange_log_report

  section "MySQL Binary Log Report"
  print_mysql_binlog_report

  if [[ "${MODE}" == "apply" ]]; then
    if [[ "${RUN_POSTGRES_CANDLES}" == "true" ]]; then
      section "Applying Postgres Candle Retention"
      require_postgres_candle_delete_ready
      apply_postgres_candle_retention
    else
      section "Applying Postgres Candle Retention"
      echo "postgres_candles	skipped"
    fi

    if [[ "${RUN_MYSQL_EXCHANGE_LOGS}" == "true" ]]; then
      section "Applying MySQL Exchange Asset Update Log Retention"
      apply_mysql_exchange_log_retention
    else
      section "Applying MySQL Exchange Asset Update Log Retention"
      echo "mysql_exchange_asset_update_logs	skipped"
    fi

    section "Applying Docker Builder Prune"
    apply_docker_builder_prune

    section "Disk After"
    print_disk_snapshot

    section "Docker Usage After"
    print_docker_snapshot
  else
    section "Dry Run"
    echo "No data was deleted. Re-run with AURALPHA_RETENTION_CONFIRM=delete and --apply to execute cleanup."
  fi
}

main "$@"
