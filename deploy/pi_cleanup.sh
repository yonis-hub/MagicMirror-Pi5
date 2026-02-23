#!/usr/bin/env bash
set -euo pipefail

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

HOME_DIR="${HOME}"
REPO_DIR="${HOME_DIR}/MagicMirror-Pi5"
KEEP_MIC_FILE="${REPO_DIR}/mic_test.wav"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

act() {
  if $APPLY; then
    eval "$1"
  else
    log "DRY-RUN: $1"
  fi
}

hash_file() {
  sha256sum "$1" | awk '{print $1}'
}

log "Starting Pi cleanup pass (apply=${APPLY})"

# 1) Clean obvious duplicate microphone test recordings in $HOME
for candidate in "${HOME_DIR}/test.wav" "${HOME_DIR}/mic_test_backup.wav"; do
  if [[ -f "$candidate" && -f "$KEEP_MIC_FILE" ]]; then
    if [[ "$(hash_file "$candidate")" == "$(hash_file "$KEEP_MIC_FILE")" ]]; then
      act "rm -f \"$candidate\""
    else
      log "Keeping $candidate (not identical to ${KEEP_MIC_FILE})"
    fi
  fi
done

# 2) Trim large top-level logs but keep recent lines
for log_file in "${HOME_DIR}/voice_listener.log" "${HOME_DIR}/magicmirror_autostart.log"; do
  if [[ -f "$log_file" ]]; then
    line_count=$(wc -l < "$log_file" || echo 0)
    if (( line_count > 4000 )); then
      cmd="tail -n 2000 \"$log_file\" > \"${log_file}.tmp\" && mv \"${log_file}.tmp\" \"$log_file\""
      act "$cmd"
    else
      log "Log size OK: ${log_file} (${line_count} lines)"
    fi
  fi
done

# 3) Remove Python bytecode caches inside repo
if [[ -d "$REPO_DIR" ]]; then
  while IFS= read -r cache_dir; do
    [[ -z "$cache_dir" ]] && continue
    act "rm -rf \"$cache_dir\""
  done < <(find "$REPO_DIR" -type d -name "__pycache__")

  while IFS= read -r pyc_file; do
    [[ -z "$pyc_file" ]] && continue
    act "rm -f \"$pyc_file\""
  done < <(find "$REPO_DIR" -type f -name "*.pyc")
fi

# 4) Report duplicate wav/log files in home for manual review
TMP_HASHES="$(mktemp)"
trap 'rm -f "$TMP_HASHES"' EXIT

find "$HOME_DIR" -maxdepth 3 -type f \( -name "*.wav" -o -name "*.log" \) -print0 | \
while IFS= read -r -d '' file; do
  if [[ -f "$file" ]]; then
    printf "%s\t%s\t%s\n" "$(hash_file "$file")" "$(stat -c %s "$file")" "$file" >> "$TMP_HASHES"
  fi
done

log "Duplicate report (hash groups with more than one file):"
sort "$TMP_HASHES" | awk -F '\t' '
{
  key=$1 FS $2
  files[key]=files[key] "\n  - " $3
  count[key]++
}
END {
  any=0
  for (k in count) {
    if (count[k] > 1) {
      any=1
      split(k, parts, FS)
      printf("hash=%s size=%s bytes%s\n", parts[1], parts[2], files[k])
    }
  }
  if (!any) {
    print "  none"
  }
}'

log "Cleanup pass completed"
if ! $APPLY; then
  log "Re-run with '--apply' to execute removals."
fi
