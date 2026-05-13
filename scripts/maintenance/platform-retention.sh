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
SCHEDULER_RUN_KEEP_RUNS=5
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-auralpha-postgres-1}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-auralpha-mysql-1}"
POSTGRES_DB="${POSTGRES_DB:-auralpha}"
POSTGRES_USER="${POSTGRES_USER:-auralpha}"
MYSQL_DATABASE="${MYSQL_DATABASE:-auralpha}"
POSTGRES_BATCH_SIZE=50000
MYSQL_BATCH_SIZE=50000
MAX_BATCHES=200
DOCKER_BUILDER_UNTIL="1h"
DOCKER_IMAGE_UNTIL="24h"
MYSQL_BINLOG_RETENTION_HOURS=1
POSTGRES_INDEX_MAX_ATTEMPTS=5
POSTGRES_INDEX_RETRY_SECONDS=15
DISK_PRESSURE_THRESHOLD_PERCENT=90
MYSQL_TEMP_RECLAIM_THRESHOLD_GB=4
SYSTEM_JOURNAL_VACUUM_SIZE="200M"
TMP_CLEANUP_PATH="/tmp"
TMP_CLEANUP_MIN_AGE_DAYS=1
RUN_DOCKER_PRUNE=true
RUN_DOCKER_BUILDER_PRUNE=true
RUN_DOCKER_IMAGE_PRUNE=true
RUN_DOCKER_VOLUME_PRUNE=true
RUN_DB_VACUUM=true
EXACT_CANDLE_COUNT=false
RUN_POSTGRES_CANDLES=true
RUN_MYSQL_SCHEDULER_RUN_LOGS=true
RUN_MYSQL_BINLOG_PURGE=true
RUN_MYSQL_TEMP_RECLAIM=true
RUN_SYSTEM_JOURNAL_VACUUM=true
RUN_TMP_CLEANUP=true
CREATE_POSTGRES_CANDLE_RETENTION_INDEX=true
DOCKER_BUILDER_PRUNE_RAN=false
DOCKER_IMAGE_PRUNE_RAN=false
DOCKER_VOLUME_PRUNE_RAN=false

function usage() {
  cat <<'USAGE'
Usage:
  scripts/maintenance/platform-retention.sh [--dry-run|--apply] [options]

Purpose:
  Retain only production-safe operational data windows:
  - Postgres market_candles_1m: keep last 90 days by open_time.
  - MySQL scheduler_run_logs: keep latest 5 finished runs per scheduler/user scope.
    Related exchange_asset_update_logs and scheduler_health_check_results cascade from those runs.
  - MySQL binary logs: purge logs older than the configured short local window.
  - MySQL InnoDB temp space: restart MySQL under disk pressure to reclaim #innodb_temp.
  - Docker build cache: prune old build cache.
  - Docker images: prune old unused images only, never the images backing running containers or volumes.
  - Docker local volumes: report attached volume footprint and prune unused local volumes only.
  - Phase 1 safe cleanup: Docker build cache, system journal vacuum, and old temp files.

Safety:
  --dry-run is the default and never deletes data.
  --apply requires AURALPHA_RETENTION_CONFIRM=delete.
  --phase1-safe-cleanup-only skips database retention, image pruning, and volume pruning.

Options:
  --phase1-safe-cleanup-only          Only run Docker build cache, journal, and temp cleanup.
  --candle-retention-days DAYS       Default: 90
  --scheduler-run-keep-runs COUNT    Default: 5
  --postgres-container NAME          Default: auralpha-postgres-1
  --mysql-container NAME             Default: auralpha-mysql-1
  --postgres-db NAME                 Default: auralpha
  --postgres-user NAME               Default: auralpha
  --mysql-database NAME              Default: auralpha
  --postgres-batch-size COUNT        Default: 50000
  --mysql-batch-size COUNT           Default: 50000
  --max-batches COUNT                Default: 200
  --docker-builder-until AGE         Default: 1h
  --docker-image-until AGE           Default: 24h
  --mysql-binlog-retention-hours N   Default: 1
  --postgres-index-max-attempts N     Default: 5
  --postgres-index-retry-seconds N    Default: 15
  --disk-pressure-threshold-percent N Default: 90
  --mysql-temp-reclaim-threshold-gb N Default: 4
  --system-journal-vacuum-size SIZE   Default: 200M
  --tmp-cleanup-path PATH             Default: /tmp, must be /tmp or under /tmp
  --tmp-cleanup-min-age-days DAYS     Default: 1
  --skip-docker-prune                Do not prune Docker build cache, unused images, or unused volumes in --apply.
  --skip-docker-builder-prune         Do not prune Docker build cache in --apply.
  --skip-docker-image-prune           Do not prune old unused Docker images in --apply.
  --skip-docker-volume-prune          Do not prune unused Docker volumes in --apply.
  --skip-mysql-binlog-purge          Do not purge MySQL binary logs in --apply.
  --skip-mysql-temp-reclaim          Do not restart MySQL to reclaim #innodb_temp.
  --skip-system-journal-vacuum        Do not vacuum system journal logs in --apply.
  --skip-tmp-cleanup                  Do not remove old files under the temp cleanup path.
  --skip-vacuum                      Do not run VACUUM ANALYZE after Postgres deletes.
  --skip-postgres-candles            Do not delete Postgres candle rows in --apply.
  --skip-mysql-scheduler-run-logs    Do not delete MySQL scheduler run logs in --apply.
  --skip-candle-retention-index      Do not create the leading Postgres open_time index.
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
      --phase1-safe-cleanup-only)
        RUN_POSTGRES_CANDLES=false
        RUN_MYSQL_SCHEDULER_RUN_LOGS=false
        RUN_MYSQL_BINLOG_PURGE=false
        RUN_MYSQL_TEMP_RECLAIM=false
        RUN_DOCKER_IMAGE_PRUNE=false
        RUN_DOCKER_VOLUME_PRUNE=false
        shift
        ;;
      --candle-retention-days)
        CANDLE_RETENTION_DAYS="${2:-}"
        shift 2
        ;;
      --scheduler-run-keep-runs|--exchange-log-keep-runs)
        SCHEDULER_RUN_KEEP_RUNS="${2:-}"
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
      --docker-image-until)
        DOCKER_IMAGE_UNTIL="${2:-}"
        shift 2
        ;;
      --mysql-binlog-retention-hours)
        MYSQL_BINLOG_RETENTION_HOURS="${2:-}"
        shift 2
        ;;
      --postgres-index-max-attempts)
        POSTGRES_INDEX_MAX_ATTEMPTS="${2:-}"
        shift 2
        ;;
      --postgres-index-retry-seconds)
        POSTGRES_INDEX_RETRY_SECONDS="${2:-}"
        shift 2
        ;;
      --disk-pressure-threshold-percent)
        DISK_PRESSURE_THRESHOLD_PERCENT="${2:-}"
        shift 2
        ;;
      --mysql-temp-reclaim-threshold-gb)
        MYSQL_TEMP_RECLAIM_THRESHOLD_GB="${2:-}"
        shift 2
        ;;
      --system-journal-vacuum-size)
        SYSTEM_JOURNAL_VACUUM_SIZE="${2:-}"
        shift 2
        ;;
      --tmp-cleanup-path)
        TMP_CLEANUP_PATH="${2:-}"
        shift 2
        ;;
      --tmp-cleanup-min-age-days)
        TMP_CLEANUP_MIN_AGE_DAYS="${2:-}"
        shift 2
        ;;
      --skip-docker-prune)
        RUN_DOCKER_PRUNE=false
        RUN_DOCKER_BUILDER_PRUNE=false
        RUN_DOCKER_IMAGE_PRUNE=false
        RUN_DOCKER_VOLUME_PRUNE=false
        shift
        ;;
      --skip-docker-builder-prune)
        RUN_DOCKER_BUILDER_PRUNE=false
        shift
        ;;
      --skip-docker-image-prune)
        RUN_DOCKER_IMAGE_PRUNE=false
        shift
        ;;
      --skip-docker-volume-prune)
        RUN_DOCKER_VOLUME_PRUNE=false
        shift
        ;;
      --skip-mysql-binlog-purge)
        RUN_MYSQL_BINLOG_PURGE=false
        shift
        ;;
      --skip-mysql-temp-reclaim)
        RUN_MYSQL_TEMP_RECLAIM=false
        shift
        ;;
      --skip-system-journal-vacuum)
        RUN_SYSTEM_JOURNAL_VACUUM=false
        shift
        ;;
      --skip-tmp-cleanup)
        RUN_TMP_CLEANUP=false
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
      --skip-mysql-scheduler-run-logs|--skip-mysql-exchange-logs)
        RUN_MYSQL_SCHEDULER_RUN_LOGS=false
        shift
        ;;
      --skip-candle-retention-index)
        CREATE_POSTGRES_CANDLE_RETENTION_INDEX=false
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
  require_uint "SCHEDULER_RUN_KEEP_RUNS" "${SCHEDULER_RUN_KEEP_RUNS}"
  require_uint "POSTGRES_BATCH_SIZE" "${POSTGRES_BATCH_SIZE}"
  require_uint "MYSQL_BATCH_SIZE" "${MYSQL_BATCH_SIZE}"
  require_uint "MAX_BATCHES" "${MAX_BATCHES}"
  require_uint "MYSQL_BINLOG_RETENTION_HOURS" "${MYSQL_BINLOG_RETENTION_HOURS}"
  require_uint "POSTGRES_INDEX_MAX_ATTEMPTS" "${POSTGRES_INDEX_MAX_ATTEMPTS}"
  require_uint "POSTGRES_INDEX_RETRY_SECONDS" "${POSTGRES_INDEX_RETRY_SECONDS}"
  require_uint "DISK_PRESSURE_THRESHOLD_PERCENT" "${DISK_PRESSURE_THRESHOLD_PERCENT}"
  require_uint "MYSQL_TEMP_RECLAIM_THRESHOLD_GB" "${MYSQL_TEMP_RECLAIM_THRESHOLD_GB}"
  require_uint "TMP_CLEANUP_MIN_AGE_DAYS" "${TMP_CLEANUP_MIN_AGE_DAYS}"
  require_safe_container_name "POSTGRES_CONTAINER" "${POSTGRES_CONTAINER}"
  require_safe_container_name "MYSQL_CONTAINER" "${MYSQL_CONTAINER}"
  require_safe_identifier "POSTGRES_DB" "${POSTGRES_DB}"
  require_safe_identifier "POSTGRES_USER" "${POSTGRES_USER}"
  require_safe_identifier "MYSQL_DATABASE" "${MYSQL_DATABASE}"

  if [[ "${DISK_PRESSURE_THRESHOLD_PERCENT}" -gt 100 ]]; then
    fail "DISK_PRESSURE_THRESHOLD_PERCENT must be between 1 and 100. Got: ${DISK_PRESSURE_THRESHOLD_PERCENT}"
  fi

  if [[ ! "${SYSTEM_JOURNAL_VACUUM_SIZE}" =~ ^[1-9][0-9]*[KMG]?$ ]]; then
    fail "SYSTEM_JOURNAL_VACUUM_SIZE must look like 200M, 1G, or 524288000. Got: ${SYSTEM_JOURNAL_VACUUM_SIZE}"
  fi

  case "${TMP_CLEANUP_PATH}" in
    /tmp|/tmp/*)
      ;;
    *)
      fail "TMP_CLEANUP_PATH must be /tmp or under /tmp. Got: ${TMP_CLEANUP_PATH}"
      ;;
  esac

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

function postgres_query_with_pgoptions() {
  local pgoptions="$1"
  local sql="$2"
  docker exec -i \
    -e POSTGRES_USER="${POSTGRES_USER}" \
    -e POSTGRES_DB="${POSTGRES_DB}" \
    -e PGOPTIONS="${pgoptions}" \
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

function print_system_journal_report() {
  if ! command -v journalctl >/dev/null 2>&1; then
    echo "system_journal	skipped_journalctl_missing"
    return
  fi

  journalctl --disk-usage || true
}

function get_tmp_cleanup_min_age_minutes() {
  echo $((TMP_CLEANUP_MIN_AGE_DAYS * 24 * 60))
}

function print_tmp_cleanup_report() {
  local min_age_minutes candidate_count
  min_age_minutes="$(get_tmp_cleanup_min_age_minutes)"

  echo "tmp_cleanup_path	${TMP_CLEANUP_PATH}"
  echo "tmp_cleanup_min_age_days	${TMP_CLEANUP_MIN_AGE_DAYS}"
  echo "tmp_cleanup_min_age_minutes	${min_age_minutes}"

  if [[ ! -d "${TMP_CLEANUP_PATH}" ]]; then
    echo "tmp_cleanup_path_size	0B"
    echo "tmp_cleanup_candidate_count	0"
    return
  fi

  du -sh "${TMP_CLEANUP_PATH}" 2>/dev/null | awk 'NR == 1 { print "tmp_cleanup_path_size\t" $1 }'
  candidate_count="$(find "${TMP_CLEANUP_PATH}" -xdev -mindepth 1 -ignore_readdir_race -mmin +"${min_age_minutes}" -print 2>/dev/null | wc -l | awk '{ print $1 }')"
  echo "tmp_cleanup_candidate_count	${candidate_count:-0}"
}

function get_docker_volume_root() {
  echo "/var/lib/docker/volumes"
}

function get_docker_volume_root_size() {
  local volume_root
  volume_root="$(get_docker_volume_root)"
  if [[ -d "${volume_root}" ]]; then
    du -sh "${volume_root}" 2>/dev/null | awk 'NR == 1 { print $1 }'
  else
    echo "0B"
  fi
}

function print_docker_volume_report() {
  local volume_root attached_count unused_count total_count
  volume_root="$(get_docker_volume_root)"
  attached_count=0
  unused_count=0
  total_count=0

  echo "volume_root	${volume_root}"
  echo "volume_root_size	$(get_docker_volume_root_size)"
  echo "volume_name	status	size	mountpoint"

  while IFS= read -r volume_name; do
    local mountpoint size status
    [[ -z "${volume_name}" ]] && continue
    total_count=$((total_count + 1))
    mountpoint="$(docker volume inspect --format '{{.Mountpoint}}' "${volume_name}" 2>/dev/null || true)"
    if docker ps -a --filter "volume=${volume_name}" -q | grep -q .; then
      status="attached"
      attached_count=$((attached_count + 1))
    else
      status="unused"
      unused_count=$((unused_count + 1))
    fi

    if [[ -n "${mountpoint}" && -d "${mountpoint}" ]]; then
      size="$(du -sh "${mountpoint}" 2>/dev/null | awk 'NR == 1 { print $1 }')"
    else
      size="0B"
    fi

    printf '%s\t%s\t%s\t%s\n' "${volume_name}" "${status}" "${size}" "${mountpoint:-unknown}"
  done < <(docker volume ls -q | sort)

  echo "volume_count	${total_count}"
  echo "attached_volume_count	${attached_count}"
  echo "unused_volume_count	${unused_count}"
}

function bytes_to_gib() {
  local bytes="${1:-0}"
  awk -v bytes="${bytes}" 'BEGIN { printf "%.2f", bytes / 1024 / 1024 / 1024 }'
}

function get_root_disk_use_percent() {
  df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

function get_dir_size_bytes() {
  local dir="$1"
  if [[ -d "${dir}" ]]; then
    du -s -B1 "${dir}" 2>/dev/null | awk 'NR == 1 { print $1 }'
  else
    echo "0"
  fi
}

function get_mysql_data_dir() {
  docker inspect \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Source}}{{end}}{{end}}' \
    "${MYSQL_CONTAINER}" 2>/dev/null || true
}

function get_mysql_innodb_temp_bytes() {
  local mysql_data_dir mysql_temp_dir
  mysql_data_dir="$(get_mysql_data_dir)"
  if [[ -z "${mysql_data_dir}" ]]; then
    echo "0"
    return
  fi

  mysql_temp_dir="${mysql_data_dir}/#innodb_temp"
  get_dir_size_bytes "${mysql_temp_dir}"
}

function print_disk_pressure_report() {
  local root_disk_use_percent mysql_data_dir mysql_temp_bytes mysql_temp_gib threshold_bytes
  root_disk_use_percent="$(get_root_disk_use_percent)"
  mysql_data_dir="$(get_mysql_data_dir)"
  mysql_temp_bytes="$(get_mysql_innodb_temp_bytes)"
  threshold_bytes=$((MYSQL_TEMP_RECLAIM_THRESHOLD_GB * 1024 * 1024 * 1024))
  mysql_temp_gib="$(bytes_to_gib "${mysql_temp_bytes}")"

  cat <<EOF
root_disk_use_percent	${root_disk_use_percent:-unknown}
disk_pressure_threshold_percent	${DISK_PRESSURE_THRESHOLD_PERCENT}
mysql_data_dir	${mysql_data_dir:-unknown}
mysql_innodb_temp_gb	${mysql_temp_gib}
mysql_temp_reclaim_threshold_gb	${MYSQL_TEMP_RECLAIM_THRESHOLD_GB}
mysql_temp_reclaim_threshold_bytes	${threshold_bytes}
run_mysql_temp_reclaim	${RUN_MYSQL_TEMP_RECLAIM}
EOF
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
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_class ix ON ix.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
   WHERE n.nspname = 'public'
     AND t.relname = 'market_candles_1m'
     AND ix.relkind = 'i'
     AND i.indisready
     AND i.indisvalid
     AND a.attname = 'open_time'
)::text;
"
}

function ensure_postgres_candle_retention_index() {
  local has_leading_open_time_index
  local attempt
  has_leading_open_time_index="$(postgres_has_leading_open_time_index)"
  has_leading_open_time_index="${has_leading_open_time_index//$'\n'/}"

  if [[ "${has_leading_open_time_index}" == "true" ]]; then
    echo "postgres_candle_retention_index	exists"
    return
  fi

  if [[ "${CREATE_POSTGRES_CANDLE_RETENTION_INDEX}" != "true" ]]; then
    fail "Refusing market_candles_1m deletes without a leading open_time index. Re-run without --skip-candle-retention-index or add one manually."
  fi

  for attempt in $(seq 1 "${POSTGRES_INDEX_MAX_ATTEMPTS}"); do
    echo "postgres_candle_retention_index	creating_attempt_${attempt}_of_${POSTGRES_INDEX_MAX_ATTEMPTS}"

    if postgres_query_with_pgoptions "-c temp_file_limit=-1 -c maintenance_work_mem=256MB" "
DROP INDEX CONCURRENTLY IF EXISTS public.idx_market_candles_1m_open_time_retention;
" && postgres_query_with_pgoptions "-c temp_file_limit=-1 -c maintenance_work_mem=256MB" "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_candles_1m_open_time_retention
  ON public.market_candles_1m (open_time);
"; then
      echo "postgres_candle_retention_index	created_or_already_exists"
      return
    fi

    if [[ "${attempt}" -lt "${POSTGRES_INDEX_MAX_ATTEMPTS}" ]]; then
      echo "postgres_candle_retention_index	retry_in_${POSTGRES_INDEX_RETRY_SECONDS}_seconds"
      sleep "${POSTGRES_INDEX_RETRY_SECONDS}"
    fi
  done

  fail "Unable to create the market_candles_1m open_time retention index after ${POSTGRES_INDEX_MAX_ATTEMPTS} attempts."
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
SELECT 'create_retention_index_on_apply' || chr(9) || '${CREATE_POSTGRES_CANDLE_RETENTION_INDEX}';
"

  if [[ "${has_leading_open_time_index}" != "true" && "${EXACT_CANDLE_COUNT}" != "true" ]]; then
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
  if [[ "${has_leading_open_time_index}" != "true" ]]; then
    ensure_postgres_candle_retention_index
    has_leading_open_time_index="$(postgres_has_leading_open_time_index)"
    has_leading_open_time_index="${has_leading_open_time_index//$'\n'/}"
  fi
  if [[ "${has_leading_open_time_index}" != "true" ]]; then
    fail "Refusing market_candles_1m deletes because leading open_time index is still missing after index setup."
  fi
}

function print_mysql_scheduler_run_log_report() {
  echo "database	keep_runs_per_scheduler_user_scope	total_scheduler_run_logs	deletable_scheduler_run_logs	deletable_scheduler_scopes	related_exchange_asset_update_logs	related_scheduler_health_check_results	oldest_deletable_run_started_at	newest_deletable_run_started_at	scheduler_run_logs_mb	exchange_asset_update_logs_mb	scheduler_health_check_results_mb"
  mysql_query "
WITH ranked_runs AS (
  SELECT
    id,
    scheduler_key,
    COALESCE(actor_user_id, '__global__') AS actor_scope,
    started_at,
    finished_at,
    ROW_NUMBER() OVER (
      PARTITION BY scheduler_key, COALESCE(actor_user_id, '__global__')
      ORDER BY started_at DESC, created_at DESC, id DESC
    ) AS run_rank
  FROM scheduler_run_logs
),
doomed_runs AS (
  SELECT id, scheduler_key, actor_scope, started_at
  FROM ranked_runs
  WHERE run_rank > ${SCHEDULER_RUN_KEEP_RUNS}
    AND finished_at IS NOT NULL
)
SELECT
  DATABASE(),
  ${SCHEDULER_RUN_KEEP_RUNS},
  (SELECT COUNT(*) FROM scheduler_run_logs),
  COUNT(*),
  COUNT(DISTINCT CONCAT(scheduler_key, ':', actor_scope)),
  (SELECT COUNT(*) FROM exchange_asset_update_logs l INNER JOIN doomed_runs d ON d.id = l.run_log_id),
  (SELECT COUNT(*) FROM scheduler_health_check_results h INNER JOIN doomed_runs d ON d.id = h.run_log_id),
  COALESCE(CAST(MIN(started_at) AS CHAR), 'none'),
  COALESCE(CAST(MAX(started_at) AS CHAR), 'none'),
  (
    SELECT ROUND((data_length + index_length) / 1024 / 1024, 2)
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'scheduler_run_logs'
  ),
  (
    SELECT ROUND((data_length + index_length) / 1024 / 1024, 2)
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'exchange_asset_update_logs'
  ),
  (
    SELECT ROUND((data_length + index_length) / 1024 / 1024, 2)
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'scheduler_health_check_results'
  )
FROM doomed_runs;
"

  echo "scheduler_key	actor_scope	total_runs	deletable_finished_runs	oldest_deletable_run_started_at	newest_deletable_run_started_at"
  mysql_query "
WITH ranked_runs AS (
  SELECT
    id,
    scheduler_key,
    COALESCE(actor_user_id, '__global__') AS actor_scope,
    started_at,
    finished_at,
    ROW_NUMBER() OVER (
      PARTITION BY scheduler_key, COALESCE(actor_user_id, '__global__')
      ORDER BY started_at DESC, created_at DESC, id DESC
    ) AS run_rank,
    COUNT(*) OVER (
      PARTITION BY scheduler_key, COALESCE(actor_user_id, '__global__')
    ) AS total_runs
  FROM scheduler_run_logs
)
SELECT
  scheduler_key,
  actor_scope,
  MAX(total_runs),
  COUNT(*),
  MIN(started_at),
  MAX(started_at)
FROM ranked_runs
WHERE run_rank > ${SCHEDULER_RUN_KEEP_RUNS}
  AND finished_at IS NOT NULL
GROUP BY scheduler_key, actor_scope
ORDER BY COUNT(*) DESC, scheduler_key ASC, actor_scope ASC
LIMIT 100;
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

function apply_mysql_scheduler_run_log_retention() {
  local deleted total_deleted batch_number
  total_deleted=0
  batch_number=0

  while [[ "${batch_number}" -lt "${MAX_BATCHES}" ]]; do
    deleted="$(mysql_query "
SET sql_log_bin = 0;
DELETE run
FROM scheduler_run_logs run
INNER JOIN (
  SELECT id
  FROM (
    SELECT id
    FROM (
      SELECT
        id,
        finished_at,
        ROW_NUMBER() OVER (
          PARTITION BY scheduler_key, COALESCE(actor_user_id, '__global__')
          ORDER BY started_at DESC, created_at DESC, id DESC
        ) AS run_rank
      FROM scheduler_run_logs
    ) ranked_runs
    WHERE ranked_runs.run_rank > ${SCHEDULER_RUN_KEEP_RUNS}
      AND ranked_runs.finished_at IS NOT NULL
  ) doomed_ids
  LIMIT ${MYSQL_BATCH_SIZE}
) doomed ON doomed.id = run.id;
SELECT ROW_COUNT();
")"
    deleted="$(printf '%s\n' "${deleted}" | tail -n 1)"
    deleted="${deleted//$'\n'/}"
    deleted="${deleted:-0}"
    total_deleted=$((total_deleted + deleted))
    batch_number=$((batch_number + 1))
    echo "mysql_scheduler_run_logs_deleted_batch_${batch_number}	${deleted}"
    if [[ "${deleted}" -eq 0 ]]; then
      break
    fi
  done

  echo "mysql_scheduler_run_logs_deleted_total	${total_deleted}"
}

function apply_mysql_binlog_purge() {
  if [[ "${RUN_MYSQL_BINLOG_PURGE}" != "true" ]]; then
    echo "mysql_binlog_purge	skipped"
    return
  fi

  mysql_query "
PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL ${MYSQL_BINLOG_RETENTION_HOURS} HOUR);
"
  echo "mysql_binlog_purge	older_than_${MYSQL_BINLOG_RETENTION_HOURS}_hours"
}

function apply_docker_builder_prune() {
  if [[ "${RUN_DOCKER_PRUNE}" != "true" || "${RUN_DOCKER_BUILDER_PRUNE}" != "true" ]]; then
    echo "docker_builder_prune	skipped"
    return
  fi

  if [[ "${DOCKER_BUILDER_PRUNE_RAN}" == "true" ]]; then
    echo "docker_builder_prune	already_run"
    return
  fi

  if docker builder prune --force --filter "until=${DOCKER_BUILDER_UNTIL}"; then
    DOCKER_BUILDER_PRUNE_RAN=true
    return
  fi

  echo "docker_builder_prune	failed"
}

function apply_docker_image_prune() {
  if [[ "${RUN_DOCKER_PRUNE}" != "true" || "${RUN_DOCKER_IMAGE_PRUNE}" != "true" ]]; then
    echo "docker_image_prune	skipped"
    return
  fi

  if [[ "${DOCKER_IMAGE_PRUNE_RAN}" == "true" ]]; then
    echo "docker_image_prune	already_run"
    return
  fi

  if docker image prune --all --force --filter "until=${DOCKER_IMAGE_UNTIL}"; then
    DOCKER_IMAGE_PRUNE_RAN=true
    return
  fi

  echo "docker_image_prune	failed"
}

function apply_docker_volume_prune() {
  if [[ "${RUN_DOCKER_PRUNE}" != "true" || "${RUN_DOCKER_VOLUME_PRUNE}" != "true" ]]; then
    echo "docker_volume_prune	skipped"
    return
  fi

  if [[ "${DOCKER_VOLUME_PRUNE_RAN}" == "true" ]]; then
    echo "docker_volume_prune	already_run"
    return
  fi

  if docker volume prune --all --force; then
    DOCKER_VOLUME_PRUNE_RAN=true
    return
  fi

  echo "docker_volume_prune	failed"
}

function apply_mysql_temp_reclaim() {
  local root_disk_use_percent mysql_temp_bytes threshold_bytes before_gb after_gb

  if [[ "${RUN_MYSQL_TEMP_RECLAIM}" != "true" ]]; then
    echo "mysql_temp_reclaim	skipped"
    return
  fi

  root_disk_use_percent="$(get_root_disk_use_percent)"
  mysql_temp_bytes="$(get_mysql_innodb_temp_bytes)"
  threshold_bytes=$((MYSQL_TEMP_RECLAIM_THRESHOLD_GB * 1024 * 1024 * 1024))
  before_gb="$(bytes_to_gib "${mysql_temp_bytes}")"

  echo "mysql_temp_reclaim_root_disk_use_percent	${root_disk_use_percent:-unknown}"
  echo "mysql_temp_reclaim_before_gb	${before_gb}"

  if [[ -z "${root_disk_use_percent}" || ! "${root_disk_use_percent}" =~ ^[0-9]+$ ]]; then
    echo "mysql_temp_reclaim	skipped_root_disk_unknown"
    return
  fi

  if [[ "${mysql_temp_bytes}" -lt "${threshold_bytes}" ]]; then
    echo "mysql_temp_reclaim	skipped_temp_below_threshold"
    return
  fi

  if [[ "${root_disk_use_percent}" -lt "${DISK_PRESSURE_THRESHOLD_PERCENT}" ]]; then
    echo "mysql_temp_reclaim	skipped_disk_below_threshold"
    return
  fi

  echo "mysql_temp_reclaim	restarting_${MYSQL_CONTAINER}"
  docker restart "${MYSQL_CONTAINER}" >/dev/null
  after_gb="$(bytes_to_gib "$(get_mysql_innodb_temp_bytes)")"
  echo "mysql_temp_reclaim	restarted_${MYSQL_CONTAINER}"
  echo "mysql_temp_reclaim_after_gb	${after_gb}"
}

function apply_system_journal_vacuum() {
  if [[ "${RUN_SYSTEM_JOURNAL_VACUUM}" != "true" ]]; then
    echo "system_journal_vacuum	skipped"
    return
  fi

  if ! command -v journalctl >/dev/null 2>&1; then
    echo "system_journal_vacuum	skipped_journalctl_missing"
    return
  fi

  journalctl --vacuum-size="${SYSTEM_JOURNAL_VACUUM_SIZE}" || {
    echo "system_journal_vacuum	failed"
    return
  }
  echo "system_journal_vacuum	size_${SYSTEM_JOURNAL_VACUUM_SIZE}"
}

function apply_tmp_cleanup() {
  local min_age_minutes

  if [[ "${RUN_TMP_CLEANUP}" != "true" ]]; then
    echo "tmp_cleanup	skipped"
    return
  fi

  if [[ ! -d "${TMP_CLEANUP_PATH}" ]]; then
    echo "tmp_cleanup	skipped_path_missing"
    return
  fi

  min_age_minutes="$(get_tmp_cleanup_min_age_minutes)"
  find "${TMP_CLEANUP_PATH}" \
    -xdev \
    -mindepth 1 \
    -ignore_readdir_race \
    -mmin +"${min_age_minutes}" \
    -exec rm -rf -- {} + 2>/dev/null || true
  echo "tmp_cleanup	older_than_${TMP_CLEANUP_MIN_AGE_DAYS}_days"
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
scheduler_run_keep_runs	${SCHEDULER_RUN_KEEP_RUNS}
postgres_container	${POSTGRES_CONTAINER}
mysql_container	${MYSQL_CONTAINER}
postgres_batch_size	${POSTGRES_BATCH_SIZE}
mysql_batch_size	${MYSQL_BATCH_SIZE}
max_batches	${MAX_BATCHES}
docker_builder_until	${DOCKER_BUILDER_UNTIL}
docker_image_until	${DOCKER_IMAGE_UNTIL}
mysql_binlog_retention_hours	${MYSQL_BINLOG_RETENTION_HOURS}
postgres_index_max_attempts	${POSTGRES_INDEX_MAX_ATTEMPTS}
postgres_index_retry_seconds	${POSTGRES_INDEX_RETRY_SECONDS}
disk_pressure_threshold_percent	${DISK_PRESSURE_THRESHOLD_PERCENT}
mysql_temp_reclaim_threshold_gb	${MYSQL_TEMP_RECLAIM_THRESHOLD_GB}
system_journal_vacuum_size	${SYSTEM_JOURNAL_VACUUM_SIZE}
tmp_cleanup_path	${TMP_CLEANUP_PATH}
tmp_cleanup_min_age_days	${TMP_CLEANUP_MIN_AGE_DAYS}
run_postgres_candles	${RUN_POSTGRES_CANDLES}
run_mysql_scheduler_run_logs	${RUN_MYSQL_SCHEDULER_RUN_LOGS}
run_mysql_binlog_purge	${RUN_MYSQL_BINLOG_PURGE}
run_mysql_temp_reclaim	${RUN_MYSQL_TEMP_RECLAIM}
run_docker_prune	${RUN_DOCKER_PRUNE}
run_docker_builder_prune	${RUN_DOCKER_BUILDER_PRUNE}
run_docker_image_prune	${RUN_DOCKER_IMAGE_PRUNE}
run_docker_volume_prune	${RUN_DOCKER_VOLUME_PRUNE}
run_system_journal_vacuum	${RUN_SYSTEM_JOURNAL_VACUUM}
run_tmp_cleanup	${RUN_TMP_CLEANUP}
EOF

  section "Disk Before"
  print_disk_snapshot

  section "Docker Usage Before"
  print_docker_snapshot

  section "Docker Volumes Before"
  print_docker_volume_report

  section "Disk Pressure Report Before Cleanup"
  print_disk_pressure_report

  section "Phase 1 Safe Cleanup Report Before"
  print_system_journal_report
  print_tmp_cleanup_report

  if [[ "${MODE}" == "apply" ]]; then
    section "Applying Early Disk Pressure Cleanup"
    apply_docker_builder_prune
    apply_system_journal_vacuum
    apply_tmp_cleanup
    apply_docker_image_prune
    apply_docker_volume_prune
    apply_mysql_temp_reclaim

    section "Disk After Early Cleanup"
    print_disk_snapshot

    section "Disk Pressure Report After Early Cleanup"
    print_disk_pressure_report

    section "Phase 1 Safe Cleanup Report After"
    print_system_journal_report
    print_tmp_cleanup_report
  fi

  section "Postgres market_candles_1m Retention Report"
  print_postgres_candle_report

  section "MySQL scheduler_run_logs Retention Report"
  print_mysql_scheduler_run_log_report

  section "MySQL Binary Log Report"
  print_mysql_binlog_report

  if [[ "${MODE}" == "apply" ]]; then
    section "Applying MySQL Binary Log Purge"
    apply_mysql_binlog_purge

    if [[ "${RUN_MYSQL_SCHEDULER_RUN_LOGS}" == "true" ]]; then
      section "Applying MySQL Scheduler Run Log Retention"
      apply_mysql_scheduler_run_log_retention
    else
      section "Applying MySQL Scheduler Run Log Retention"
      echo "mysql_scheduler_run_logs	skipped"
    fi

    section "Applying Docker Builder Prune"
    apply_docker_builder_prune

    section "Applying Docker Image Prune"
    apply_docker_image_prune

    section "Applying Docker Volume Prune"
    apply_docker_volume_prune

    if [[ "${RUN_POSTGRES_CANDLES}" == "true" ]]; then
      section "Applying Postgres Candle Retention"
      require_postgres_candle_delete_ready
      apply_postgres_candle_retention
    else
      section "Applying Postgres Candle Retention"
      echo "postgres_candles	skipped"
    fi

    section "Disk After"
    print_disk_snapshot

    section "Docker Usage After"
    print_docker_snapshot

    section "Docker Volumes After"
    print_docker_volume_report
  else
    section "Dry Run"
    echo "No data was deleted. Re-run with AURALPHA_RETENTION_CONFIRM=delete and --apply to execute cleanup."
  fi
}

main "$@"
