#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/docker-compose.yml"

failures=0

ok() {
  printf 'ok: %s\n' "$*"
}

warn() {
  printf 'warn: %s\n' "$*" >&2
}

fail() {
  printf 'error: %s\n' "$*" >&2
  failures=$((failures + 1))
}

require_file() {
  local path="$1"
  if [ -f "$ROOT/$path" ]; then
    ok "$path exists"
  else
    fail "$path is missing"
  fi
}

require_dir() {
  local path="$1"
  if [ -d "$ROOT/$path" ]; then
    ok "$path exists"
  else
    fail "$path is missing"
  fi
}

require_compose_text() {
  local needle="$1"
  local label="$2"
  if grep -Fq -- "$needle" "$COMPOSE"; then
    ok "$label"
  else
    fail "$label missing from docker-compose.yml"
  fi
}

if [ ! -f "$COMPOSE" ]; then
  fail "docker-compose.yml is missing"
else
  ok "docker-compose.yml exists"
fi

require_dir "hermes-chat/app"
require_dir "hermes-chat/components"
require_dir "hermes-chat/lib"
require_file "hermes-chat/package.json"
require_file "hermes-chat/docker-entrypoint.sh"
require_file "hermes-chat/app/setup/page.tsx"
require_file "hermes-chat/app/api/setup/status/route.ts"
require_file "hermes-chat/lib/setup-status.ts"
require_file "chat/Dockerfile"
require_file "hermes-agent.Dockerfile"
require_file "gateway-entrypoint.sh"
require_file "hermes-bridge/worker.mjs"
require_file "shared-ingest-worker/Dockerfile"
require_file ".env.example"
require_file "hermes-data/.env.example"

REQUIRED_PATCH_MOUNTS=(
  "patches/gateway_run.py|/opt/hermes/gateway/run.py|gateway bootstrap"
  "patches/api_server.py|/opt/hermes/gateway/platforms/api_server.py|OpenAI-compatible API server"
  "patches/cron_scheduler.py|/opt/hermes/cron/scheduler.py|cron scheduler webhook delivery"
  "patches/cron_jobs.py|/opt/hermes/cron/jobs.py|cron jobs permissions"
  "patches/skill_usage.py|/opt/hermes/tools/skill_usage.py|skill usage permissions"
  "patches/skills_sync.py|/opt/hermes/tools/skills_sync.py|skill sync permissions"
  "patches/openrouter_sidecar_accounting.py|/opt/hermes/tools/openrouter_sidecar_accounting.py|OpenRouter image accounting"
  "patches/openrouter_image_helpers.py|/opt/hermes/tools/openrouter_image_helpers.py|OpenRouter image helpers"
  "patches/image_generation_tool.py|/opt/hermes/tools/image_generation_tool.py|image generation tool"
  "patches/image_edit_tool.py|/opt/hermes/tools/image_edit_tool.py|image edit tool"
  "patches/file_operations.py|/opt/hermes/tools/file_operations.py|file operations"
  "patches/workspace_knowledge_tool.py|/opt/hermes/tools/workspace_knowledge_tool.py|workspace knowledge bridge"
  "patches/toolsets.py|/opt/hermes/toolsets.py|toolset registration"
  "patches/hermes_cli_config.py|/opt/hermes/hermes_cli/config.py|Hermes CLI config permissions"
  "patches/hermes_cli_tools_config.py|/opt/hermes/hermes_cli/tools_config.py|Hermes CLI tools config"
  "patches/smart_model_routing.py|/opt/hermes/agent/smart_model_routing.py|smart model routing shim"
)

for spec in "${REQUIRED_PATCH_MOUNTS[@]}"; do
  IFS='|' read -r rel container_path label <<<"$spec"
  require_file "$rel"
  require_compose_text "./$rel:$container_path:ro" "$label patch mount"
done

if grep -Fq "  mqtt:" "$COMPOSE"; then
  ok "MQTT optional service is enabled"
  require_compose_text "./mqtt/config:/mosquitto/config:ro" "MQTT config mount"
  require_compose_text "mqtt_data:" "MQTT named volume"
  require_file "mqtt/config/acl"
  require_file "mqtt/config/mosquitto.conf"
else
  ok "MQTT optional service is absent"
fi

if find "$ROOT/patches" \( -name '__pycache__' -o -name '*.pyc' \) -print -quit | grep -q .; then
  fail "patches/ contains Python bytecode; remove __pycache__ and *.pyc before publishing"
else
  ok "patches/ has no Python bytecode"
fi

if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  tracked_secret_files="$(
    git -C "$ROOT" ls-files \
      .env \
      hermes-chat/.env \
      hermes-chat/.env.local \
      hermes-data/.env \
      hermes-data/auth.json \
      hermes-data/response_store.db \
      mqtt/config/passwords \
      2>/dev/null || true
  )"
  if [ -n "$tracked_secret_files" ]; then
    fail "secret/runtime files are tracked by git: $(printf '%s' "$tracked_secret_files" | tr '\n' ' ')"
  else
    ok "git is not tracking the known secret/runtime files"
  fi
else
  warn "not inside a git worktree; skipped tracked-secret check"
fi

require_compose_text "HERMESCHAT_INTERNAL_URL" "Hermes gateway can reach HermesChat internal API"
require_compose_text "HERMESCHAT_INTERNAL_TOKEN" "Hermes gateway internal token wiring"
require_compose_text "HERMES_DASHBOARD_URL" "Hermes dashboard setup URL wiring"
require_compose_text "HERMES_PROJECTS_SHARED_FS_ROOT" "shared workspace mount wiring"
require_compose_text "BUILDS_MANIFEST_PATH" "Builds manifest wiring"
require_compose_text "shared-ingest-worker:" "shared ingest worker service"

if [ "$failures" -gt 0 ]; then
  printf '\nHermes integration verification failed with %s issue(s).\n' "$failures" >&2
  exit 1
fi

printf '\nHermes integration verification passed.\n'
