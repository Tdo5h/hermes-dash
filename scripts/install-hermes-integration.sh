#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="chat"
DO_BUILD=0
DO_UP=0
VERIFY_ONLY=0
DASHBOARD_URL=""
INSTALL_OPEN_DESIGN=1

usage() {
  cat <<'USAGE'
Usage: scripts/install-hermes-integration.sh [options]

Prepares a fresh Hermes Chat checkout so it can run with the Hermes gateway patches.

Options:
  --build          Run docker compose build after preparing runtime dirs.
  --up             Run docker compose up -d after preparing runtime dirs. Implies --build.
  --profile NAME   Compose profile to use. Default: chat.
  --dashboard-url URL
                   Public/tunnel URL for the Hermes dashboard connect screen.
                   Example: https://dashboard.example.com
  --no-open-design
                   Do not fetch Open Design assets into hermes-data/open-design.
  --verify-only    Only verify required patch files/mounts; do not create runtime dirs.
  -h, --help       Show this help.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build)
      DO_BUILD=1
      ;;
    --up)
      DO_BUILD=1
      DO_UP=1
      ;;
    --profile)
      PROFILE="${2:-}"
      if [ -z "$PROFILE" ]; then
        echo "missing value for --profile" >&2
        exit 2
      fi
      shift
      ;;
    --dashboard-url)
      DASHBOARD_URL="${2:-}"
      if [ -z "$DASHBOARD_URL" ]; then
        echo "missing value for --dashboard-url" >&2
        exit 2
      fi
      shift
      ;;
    --no-open-design)
      INSTALL_OPEN_DESIGN=0
      ;;
    --verify-only)
      VERIFY_ONLY=1
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

cd "$ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for safe .env editing. Install python3 and rerun." >&2
  exit 1
fi

scripts/verify-hermes-integration-patches.sh

if [ "$VERIFY_ONLY" -eq 1 ]; then
  exit 0
fi

copy_example() {
  local example="$1"
  local target="$2"
  if [ -f "$target" ]; then
    echo "exists: $target"
    return
  fi
  if [ ! -f "$example" ]; then
    echo "missing example: $example" >&2
    exit 1
  fi
  cp "$example" "$target"
  chmod 600 "$target" 2>/dev/null || true
  echo "created: $target from $example"
}

mkdir -p \
  builds \
  hermes-data/cache \
  hermes-data/checkpoints \
  hermes-data/cron/output \
  hermes-data/home \
  hermes-data/logs \
  hermes-data/memories \
  hermes-data/projects \
  hermes-data/sandboxes \
  hermes-data/sessions \
  hermes-data/tool_images \
  hermes-data/workspace \
  environments/business-test/data/shared-ingest/coord \
  environments/business-test/data/shared-wiki

if grep -Fq "  mqtt:" docker-compose.yml; then
  mkdir -p mqtt/config mqtt/data mqtt/log
fi

if [ ! -f builds/manifest.json ]; then
  printf '{\n  "apps": []\n}\n' > builds/manifest.json
  echo "created: builds/manifest.json"
fi

if [ ! -f hermes-data/cron/jobs.json ]; then
  printf '{\n  "jobs": []\n}\n' > hermes-data/cron/jobs.json
  echo "created: hermes-data/cron/jobs.json"
fi

copy_example ".env.example" ".env"
copy_example "hermes-data/.env.example" "hermes-data/.env"

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  python3 - "$file" "$key" "$value" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
line = f"{key}={value}"
lines = path.read_text().splitlines()
out = []
done = False
for existing in lines:
    if existing.startswith(f"{key}=") or existing.startswith(f"#{key}="):
        out.append(line)
        done = True
    else:
        out.append(existing)
if not done:
    if out and out[-1].strip():
        out.append("")
    out.append(line)
path.write_text("\n".join(out) + "\n")
PY
}

env_value() {
  local file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key {print substr($0, length(key) + 2); exit}' "$file" 2>/dev/null || true
}

normalize_runtime_permissions() {
  local runtime_uid
  local runtime_gid
  runtime_uid="$(env_value ".env" "HERMES_FS_UID")"
  runtime_gid="$(env_value ".env" "HERMES_FS_GID")"
  runtime_uid="${runtime_uid:-10000}"
  runtime_gid="${runtime_gid:-1001}"

  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$runtime_uid:$runtime_gid" \
      hermes-data \
      builds \
      environments/business-test/data/shared-ingest \
      environments/business-test/data/shared-wiki \
      2>/dev/null || true
  else
    echo "warn: not root; skipping runtime ownership normalization. If containers cannot read hermes-data/.env, rerun with sudo/root." >&2
  fi

  chmod 750 hermes-data 2>/dev/null || true
  [ -f hermes-data/.env ] && chmod 640 hermes-data/.env 2>/dev/null || true
  [ -f hermes-data/auth.json ] && chmod 640 hermes-data/auth.json 2>/dev/null || true
  find builds environments/business-test/data/shared-ingest environments/business-test/data/shared-wiki \
    -type d -exec chmod g+rwXs {} + 2>/dev/null || true
  find builds environments/business-test/data/shared-ingest environments/business-test/data/shared-wiki \
    -type f -exec chmod g+rw {} + 2>/dev/null || true
  echo "normalized: runtime ownership/permissions for Hermes containers"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  fi
}

root_token="$(env_value ".env" "HERMES_TOKEN")"
data_token="$(env_value "hermes-data/.env" "API_SERVER_KEY")"
if [ -z "$root_token" ] && [ -z "$data_token" ]; then
  shared_token="$(generate_secret)"
  set_env_value ".env" "HERMES_TOKEN" "$shared_token"
  set_env_value "hermes-data/.env" "API_SERVER_KEY" "$shared_token"
  echo "generated: shared HERMES_TOKEN / API_SERVER_KEY"
elif [ -n "$root_token" ] && [ -z "$data_token" ]; then
  set_env_value "hermes-data/.env" "API_SERVER_KEY" "$root_token"
  echo "synced: hermes-data/.env API_SERVER_KEY from .env HERMES_TOKEN"
elif [ -z "$root_token" ] && [ -n "$data_token" ]; then
  set_env_value ".env" "HERMES_TOKEN" "$data_token"
  echo "synced: .env HERMES_TOKEN from hermes-data/.env API_SERVER_KEY"
elif [ "$root_token" != "$data_token" ]; then
  echo "error: .env HERMES_TOKEN and hermes-data/.env API_SERVER_KEY differ" >&2
  echo "fix them or remove one so the installer can sync safely" >&2
  exit 1
else
  echo "exists: shared HERMES_TOKEN / API_SERVER_KEY"
fi

api_server_host="$(env_value "hermes-data/.env" "API_SERVER_HOST")"
if [ -z "$api_server_host" ]; then
  set_env_value "hermes-data/.env" "API_SERVER_HOST" "0.0.0.0"
  echo "configured: hermes-data/.env API_SERVER_HOST=0.0.0.0"
fi

if [ -n "$DASHBOARD_URL" ]; then
  set_env_value ".env" "HERMES_DASHBOARD_URL" "$DASHBOARD_URL"
  echo "configured: HERMES_DASHBOARD_URL=$DASHBOARD_URL"
fi

if grep -Fq "  mqtt:" docker-compose.yml && [ ! -f mqtt/config/passwords ]; then
  : > mqtt/config/passwords
  chmod 600 mqtt/config/passwords 2>/dev/null || true
  echo "created: mqtt/config/passwords"
  echo "note: MQTT auth file is empty. Add users with mosquitto_passwd before using MQTT device integrations."
fi

if [ "$INSTALL_OPEN_DESIGN" -eq 1 ] && [ ! -d hermes-data/open-design/.git ]; then
  if command -v git >/dev/null 2>&1; then
    echo "fetching: Open Design assets for Create Studio"
    git clone --depth 1 https://github.com/nexu-io/open-design.git hermes-data/open-design
  else
    echo "warn: git not available; skipping Open Design asset fetch" >&2
  fi
fi

if [ "$INSTALL_OPEN_DESIGN" -eq 1 ]; then
  if [ -f hermes-data/open-design/design-systems/stripe/DESIGN.md ] && \
     [ -f hermes-data/open-design/skills/email-marketing/SKILL.md ]; then
    echo "verified: Open Design DNA and Create skills are available"
  else
    echo "warn: Open Design assets are missing or incomplete; Create Studio will fall back to local skills and Design DNA will be empty." >&2
    echo "      Rerun without --no-open-design after git/network access is available." >&2
  fi
fi

find patches \( -name '__pycache__' -o -name '*.pyc' \) -prune -exec rm -rf {} +
normalize_runtime_permissions

echo
echo "Before first real use:"
echo "1. Start the stack."
echo "2. Open the Hermes dashboard and connect Codex / ChatGPT."
echo "3. Open HermesChat /setup and press Check again."
echo "Deepgram is optional and only enables microphone dictation/read-aloud."
echo "OpenRouter is optional for extra models/advanced routing; it is not required for the Codex default path."

if [ "$DO_BUILD" -eq 1 ]; then
  export DOCKER_BUILDKIT=1
  docker compose --profile "$PROFILE" build
fi

if [ "$DO_UP" -eq 1 ]; then
  docker compose --profile "$PROFILE" up -d
fi

echo "Hermes integration install preparation complete."
