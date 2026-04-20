#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"

LOCAL_FRONTEND_DIR="${LOCAL_FRONTEND_DIR:-${ROOT_DIR}/../../Frontend/aurAlphaApp}"
REMOTE_FRONTEND_DIR="${REMOTE_FRONTEND_DIR:-/opt/auralpha/Frontend/aurAlphaApp}"
REMOTE_BUNDLE_PATH="${REMOTE_BUNDLE_PATH:-/tmp/auralphaapp-frontend-sync.bundle}"
LOCAL_REF="${LOCAL_REF:-}"
DRY_RUN=false

function usage() {
  cat <<'EOF'
Usage:
  bash scripts/deploy/platform-sync-frontend-bundle.sh <ssh-target> [options]

Options:
  --local-ref <ref>             Local frontend branch/ref to bundle. Defaults to current branch.
  --local-frontend-dir <path>   Local frontend repo path.
  --remote-frontend-dir <path>  Remote frontend repo path.
  --remote-bundle-path <path>   Temporary bundle path on the remote host.
  --dry-run                     Validate only; do not create, copy, or apply a bundle.

Why this exists:
  The production droplet may not have GitHub credentials for the private
  frontend repo. This script lets a trusted local machine sync the frontend
  repo by sending a Git bundle over SSH and fast-forwarding the remote tree.
EOF
}

function require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    exit 1
  fi
}

function require_clean_repo() {
  local repo_dir="$1"
  local label="$2"
  local status

  status="$(git -C "${repo_dir}" status --porcelain)"
  if [[ -n "${status}" ]]; then
    echo "${label} repo has local changes; refusing to sync." >&2
    echo "${status}" >&2
    exit 1
  fi
}

SSH_TARGET="${1:-}"
if [[ -z "${SSH_TARGET}" || "${SSH_TARGET}" == "-h" || "${SSH_TARGET}" == "--help" ]]; then
  usage
  exit $([[ -z "${SSH_TARGET}" ]] && echo 1 || echo 0)
fi
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local-ref)
      LOCAL_REF="${2:-}"
      shift 2
      ;;
    --local-frontend-dir)
      LOCAL_FRONTEND_DIR="${2:-}"
      shift 2
      ;;
    --remote-frontend-dir)
      REMOTE_FRONTEND_DIR="${2:-}"
      shift 2
      ;;
    --remote-bundle-path)
      REMOTE_BUNDLE_PATH="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command git
require_command ssh
require_command scp
require_command mktemp

if [[ ! -d "${LOCAL_FRONTEND_DIR}/.git" ]]; then
  echo "Local frontend repo not found: ${LOCAL_FRONTEND_DIR}" >&2
  exit 1
fi

if [[ -z "${LOCAL_REF}" ]]; then
  LOCAL_REF="$(git -C "${LOCAL_FRONTEND_DIR}" branch --show-current)"
fi

if [[ -z "${LOCAL_REF}" ]]; then
  echo "Could not resolve local frontend branch. Pass --local-ref explicitly." >&2
  exit 1
fi

if [[ ! "${LOCAL_REF}" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Refusing unsafe local ref name: ${LOCAL_REF}" >&2
  exit 1
fi

require_clean_repo "${LOCAL_FRONTEND_DIR}" "Local frontend"

LOCAL_HEAD="$(git -C "${LOCAL_FRONTEND_DIR}" rev-parse "${LOCAL_REF}")"
REMOTE_HEAD="$(
  ssh "${SSH_TARGET}" \
    "git -C '${REMOTE_FRONTEND_DIR}' rev-parse HEAD"
)"
REMOTE_STATUS="$(
  ssh "${SSH_TARGET}" \
    "git -C '${REMOTE_FRONTEND_DIR}' status --porcelain"
)"

if [[ -n "${REMOTE_STATUS}" ]]; then
  echo "Remote frontend repo has local changes; refusing to sync." >&2
  echo "${REMOTE_STATUS}" >&2
  exit 1
fi

if [[ "${LOCAL_HEAD}" == "${REMOTE_HEAD}" ]]; then
  echo "Remote frontend is already at ${LOCAL_REF} (${LOCAL_HEAD})."
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "Dry run passed; no remote refs were updated."
    exit 0
  fi
  ssh "${SSH_TARGET}" \
    "git -C '${REMOTE_FRONTEND_DIR}' update-ref 'refs/remotes/origin/${LOCAL_REF}' '${LOCAL_HEAD}'"
  exit 0
fi

if ! git -C "${LOCAL_FRONTEND_DIR}" merge-base --is-ancestor "${REMOTE_HEAD}" "${LOCAL_HEAD}"; then
  echo "Remote frontend HEAD is not an ancestor of local ${LOCAL_REF}; refusing non-fast-forward sync." >&2
  echo "remote=${REMOTE_HEAD}" >&2
  echo "local=${LOCAL_HEAD}" >&2
  exit 1
fi

echo "Frontend bundle sync plan:"
echo "- local repo: ${LOCAL_FRONTEND_DIR}"
echo "- local ref: ${LOCAL_REF} (${LOCAL_HEAD})"
echo "- remote repo: ${SSH_TARGET}:${REMOTE_FRONTEND_DIR}"
echo "- remote head: ${REMOTE_HEAD}"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry run passed; no bundle was created or applied."
  exit 0
fi

BUNDLE_PATH="$(mktemp "${TMPDIR:-/tmp}/auralphaapp-frontend.XXXXXX.bundle")"
trap 'rm -f "${BUNDLE_PATH}"' EXIT

git -C "${LOCAL_FRONTEND_DIR}" bundle create "${BUNDLE_PATH}" "${LOCAL_REF}" "^${REMOTE_HEAD}"
scp "${BUNDLE_PATH}" "${SSH_TARGET}:${REMOTE_BUNDLE_PATH}"

ssh "${SSH_TARGET}" bash -s -- "${REMOTE_FRONTEND_DIR}" "${REMOTE_BUNDLE_PATH}" "${LOCAL_REF}" <<'REMOTE_SYNC'
set -euo pipefail

REMOTE_FRONTEND_DIR="$1"
REMOTE_BUNDLE_PATH="$2"
LOCAL_REF="$3"
BUNDLE_REF="refs/remotes/local-bundle/${LOCAL_REF}"

git -C "${REMOTE_FRONTEND_DIR}" bundle verify "${REMOTE_BUNDLE_PATH}"
git -C "${REMOTE_FRONTEND_DIR}" fetch "${REMOTE_BUNDLE_PATH}" "${LOCAL_REF}:${BUNDLE_REF}"
git -C "${REMOTE_FRONTEND_DIR}" merge --ff-only "${BUNDLE_REF}"
git -C "${REMOTE_FRONTEND_DIR}" update-ref "refs/remotes/origin/${LOCAL_REF}" HEAD
git -C "${REMOTE_FRONTEND_DIR}" status -sb
REMOTE_SYNC

echo "Frontend bundle sync completed successfully."
