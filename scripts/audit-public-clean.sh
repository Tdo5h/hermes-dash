#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"
failures=0

fail() {
  printf 'error: %s\n' "$*" >&2
  failures=$((failures + 1))
}

ok() {
  printf 'ok: %s\n' "$*"
}

require_absent_path() {
  local rel="$1"
  if [ -e "$ROOT/$rel" ]; then
    fail "forbidden path exists: $rel"
  fi
}

require_absent_find() {
  local label="$1"
  shift
  local found
  found="$(find "$ROOT" "$@" -print -quit 2>/dev/null || true)"
  if [ -n "$found" ]; then
    fail "$label found: ${found#$ROOT/}"
  else
    ok "$label absent"
  fi
}

require_absent_path ".env"
require_absent_path "hermes-chat/.env"
require_absent_path "hermes-chat/.env.local"
require_absent_path "hermes-data/.env"
require_absent_path "hermes-data/auth.json"
require_absent_path "hermes-data/response_store.db"
require_absent_path "mqtt/config/passwords"
require_absent_path "mqtt"

require_absent_find "node_modules" -type d -name node_modules -not -path "$ROOT/.git/*"
require_absent_find "Next build output" -type d -name .next -not -path "$ROOT/.git/*"
require_absent_find "Python bytecode cache" \( -type d -name __pycache__ -o -type f -name '*.pyc' \) -not -path "$ROOT/.git/*"
require_absent_find "SQLite/runtime database" -type f \( -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \) -not -path "$ROOT/.git/*"
require_absent_find "runtime session dumps" -path '*/hermes-data/sessions/*' -type f -not -path "$ROOT/.git/*"
require_absent_find "runtime logs" -path '*/hermes-data/logs/*' -type f -not -path "$ROOT/.git/*"
require_absent_find "personal project vault contents" -path '*/hermes-data/projects/*' -type f -not -path "$ROOT/.git/*"
require_absent_find "secret directories" -type d -name .secrets -not -path "$ROOT/.git/*"

COMMON_RG_ARGS=(
  --hidden
  --glob '!.git'
  --glob '!node_modules'
  --glob '!.next'
  --glob '!*.png'
  --glob '!*.jpg'
  --glob '!*.jpeg'
  --glob '!*.webp'
  --glob '!*.gif'
  --glob '!*.pdf'
  --glob '!*.ico'
  --glob '!*.woff'
  --glob '!*.woff2'
  --glob '!*.ttf'
  --glob '!scripts/audit-public-clean.sh'
  --glob '!**/scripts/audit-public-clean.sh'
)

if [ -n "${HERMES_PUBLIC_PRIVATE_TERMS:-}" ]; then
  if rg -n -i "${COMMON_RG_ARGS[@]}" "$HERMES_PUBLIC_PRIVATE_TERMS" "$ROOT" >/tmp/hermes-public-personal-audit.txt 2>/dev/null; then
    fail "private references matched HERMES_PUBLIC_PRIVATE_TERMS:"
    sed -n '1,80p' /tmp/hermes-public-personal-audit.txt >&2
  else
    ok "no configured private references"
  fi
else
  ok "no private-term audit configured"
fi

SECRET_RE='(sk-or-v1-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
if rg -n "${COMMON_RG_ARGS[@]}" "$SECRET_RE" "$ROOT" >/tmp/hermes-public-secret-audit.txt 2>/dev/null; then
  fail "secret-looking values remain:"
  sed -n '1,80p' /tmp/hermes-public-secret-audit.txt >&2
else
  ok "no secret-looking values"
fi

if [ "$failures" -gt 0 ]; then
  printf '\nPublic clean audit failed with %s issue(s).\n' "$failures" >&2
  exit 1
fi

printf '\nPublic clean audit passed.\n'
