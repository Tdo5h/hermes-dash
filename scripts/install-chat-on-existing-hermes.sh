#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_HOME=""
DASHBOARD_URL=""
I_UNDERSTAND=0
RUN_UP=0

usage() {
  cat <<'USAGE'
Usage: scripts/install-chat-on-existing-hermes.sh --hermes-home PATH [options]

Existing Hermes install path:
  - Backs up this stack's hermes-data directory.
  - Copies selected existing Hermes home files into this stack's hermes-data.
  - Runs the HermesChat patch verification/install prep.

This does NOT patch your original Hermes directory in place. It imports it into
this stack copy so Docker can run Hermes with the required patch mounts.

Options:
  --hermes-home PATH   Existing Hermes home, usually /root/.hermes or /opt/data.
  --dashboard-url URL  Public/tunnel URL for the Hermes dashboard connect flow.
  --up                 Start the patched chat stack after import.
  --i-understand       Required acknowledgement for the import/overwrite warning.
  -h, --help           Show this help.

Warning:
  This stack uses patched Hermes modules, different compose wiring, and Hermes
  Kanban as temporary sub-agent staging infrastructure. Do not point it at a
  production Hermes home without a backup and a test window.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --hermes-home)
      SOURCE_HOME="${2:-}"
      shift
      ;;
    --dashboard-url)
      DASHBOARD_URL="${2:-}"
      shift
      ;;
    --up)
      RUN_UP=1
      ;;
    --i-understand)
      I_UNDERSTAND=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ -z "$SOURCE_HOME" ]; then
  echo "missing --hermes-home PATH" >&2
  usage >&2
  exit 2
fi

if [ "$I_UNDERSTAND" -ne 1 ]; then
  cat >&2 <<'EOF'
Refusing without --i-understand.

This import changes how Hermes runs:
- Hermes will run through this Docker stack.
- Local patch modules override parts of Hermes.
- Hermes Kanban is used as staging infrastructure for sub-agent work.
- Stack hermes-data may be overwritten/merged from your existing Hermes home.

Run again with --i-understand after taking a backup.
EOF
  exit 2
fi

if [ ! -d "$SOURCE_HOME" ]; then
  echo "Hermes home not found: $SOURCE_HOME" >&2
  exit 1
fi

cd "$ROOT"

backup_dir="backups/existing-hermes-import-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
if [ -d hermes-data ]; then
  tar -C hermes-data -czf "$backup_dir/hermes-data-before-import.tar.gz" .
  echo "backup: $backup_dir/hermes-data-before-import.tar.gz"
fi
tar -C "$SOURCE_HOME" -czf "$backup_dir/source-hermes-home.tar.gz" .
echo "backup: $backup_dir/source-hermes-home.tar.gz"

mkdir -p hermes-data

rsync -a \
  --exclude='.env' \
  --exclude='.secrets/' \
  --exclude='.local/' \
  --exclude='logs/' \
  --exclude='sessions/' \
  --exclude='tool_images/' \
  --exclude='*.log' \
  "$SOURCE_HOME"/ hermes-data/

install_args=()
if [ "$RUN_UP" -eq 1 ]; then
  install_args+=(--up)
fi
if [ -n "$DASHBOARD_URL" ]; then
  install_args+=(--dashboard-url "$DASHBOARD_URL")
fi

scripts/install-hermes-integration.sh "${install_args[@]}"

cat <<EOF

Existing Hermes import complete.

Backups are in:
  $backup_dir

Open /setup in HermesChat, then connect/reconnect Codex / ChatGPT in the Hermes
dashboard if the setup status says it is missing.
EOF
