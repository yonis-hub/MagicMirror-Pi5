#!/usr/bin/env bash
set -euo pipefail

TARGET_USER="${1:-${USER:-hyonis}}"
REPO_DIR="/home/${TARGET_USER}/MagicMirror-Pi5"
MODULE_DIR="${REPO_DIR}/magicmirror/modules/MMM-MyScoreboard"
UPSTREAM_URL="${MYSCOREBOARD_UPSTREAM_URL:-https://github.com/dathbe/MMM-MyScoreboard.git}"
BRANCH="${MYSCOREBOARD_BRANCH:-master}"
TMP_DIR="$(mktemp -d)"
UPDATED=0

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

tree_hash() {
  local dir="$1"
  (
    cd "$dir"
    find . \
      -mindepth 1 \
      -type f \
      ! -path "./.git/*" \
      ! -path "./logos_custom/*" \
      -print0 | sort -z | xargs -0 sha256sum
  ) | sha256sum | awk '{print $1}'
}

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

if [[ ! -d "${MODULE_DIR}" ]]; then
  log "MMM-MyScoreboard directory not found: ${MODULE_DIR}"
  exit 1
fi

log "Checking MMM-MyScoreboard updates from ${UPSTREAM_URL} (${BRANCH})"

if [[ -d "${MODULE_DIR}/.git" ]]; then
  git -C "${MODULE_DIR}" fetch origin "${BRANCH}"
  LOCAL_SHA="$(git -C "${MODULE_DIR}" rev-parse HEAD)"
  REMOTE_SHA="$(git -C "${MODULE_DIR}" rev-parse "origin/${BRANCH}")"
  if [[ "${LOCAL_SHA}" != "${REMOTE_SHA}" ]]; then
    log "Updating git-based MMM-MyScoreboard checkout"
    git -C "${MODULE_DIR}" checkout "${BRANCH}"
    git -C "${MODULE_DIR}" reset --hard "origin/${BRANCH}"
    UPDATED=1
  fi
else
  git clone --depth 1 --branch "${BRANCH}" "${UPSTREAM_URL}" "${TMP_DIR}/upstream"
  LOCAL_HASH="$(tree_hash "${MODULE_DIR}")"
  UPSTREAM_HASH="$(tree_hash "${TMP_DIR}/upstream")"

  if [[ "${LOCAL_HASH}" == "${UPSTREAM_HASH}" ]]; then
    log "MMM-MyScoreboard snapshot already up to date"
  else
    if [[ -d "${MODULE_DIR}/logos_custom" ]]; then
      cp -a "${MODULE_DIR}/logos_custom" "${TMP_DIR}/logos_custom_backup"
    fi

    find "${MODULE_DIR}" -mindepth 1 -maxdepth 1 ! -name "logos_custom" -exec rm -rf {} +
    cp -a "${TMP_DIR}/upstream"/. "${MODULE_DIR}/"
    rm -rf "${MODULE_DIR}/.git"

    if [[ -d "${TMP_DIR}/logos_custom_backup" ]]; then
      rm -rf "${MODULE_DIR}/logos_custom"
      mv "${TMP_DIR}/logos_custom_backup" "${MODULE_DIR}/logos_custom"
    fi

    UPDATED=1
  fi
fi

if [[ "${UPDATED}" -eq 1 ]]; then
  log "MMM-MyScoreboard updated; installing dependencies"
  if command -v npm >/dev/null 2>&1; then
    (
      cd "${MODULE_DIR}"
      npm install --omit=dev --no-audit --no-fund
    )
  fi

  if systemctl list-unit-files | grep -q "^magicmirror@${TARGET_USER}\\.service"; then
    log "Restarting magicmirror@${TARGET_USER}.service"
    systemctl restart "magicmirror@${TARGET_USER}.service"
  fi
else
  log "MMM-MyScoreboard already up to date"
fi
