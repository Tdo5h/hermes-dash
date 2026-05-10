#!/bin/sh
set -e
# Vault: owner hermes (10000) so agent tools always have owner write; group 1001 matches HermesChat nextjs
# for uploads via group permission. Setgid keeps new files in group 1001.
#
# Ownership defaults: HERMES_FS_UID=10000 HERMES_FS_GID=1001
# Override via container env (stack root `.env` → docker compose) or lines in hermes-data `.env`:
#   HERMES_FS_UID=10000
#   HERMES_FS_GID=1001
# (Only these keys are read from `.env` — the file is not sourced, so no shell metacharacters.)
#
# If you run `docker exec hermes-gateway hermes model` as root, auth.json becomes root:root and the
# gateway (user hermes) cannot read it. Set HERMES_AUTH_AUTOFIX=0 to disable the background repair loop.

_read_env_file_kv() {
  _k="$1"
  _f="$2"
  if [ ! -r "$_f" ]; then
    return 0
  fi
  _line=$(grep -E "^[[:space:]]*${_k}=" "$_f" 2>/dev/null | tail -n 1) || true
  if [ -z "$_line" ]; then
    return 0
  fi
  _val=${_line#*=}
  _val=$(printf %s "$_val" | tr -d '\r')
  case "$_val" in
    \"*) _val=${_val#\"}; _val=${_val%\"} ;;
    \'*) _val=${_val#\'}; _val=${_val%\'} ;;
  esac
  printf %s "$_val"
}

HERMES_FS_UID=${HERMES_FS_UID:-}
if [ -z "$HERMES_FS_UID" ]; then
  HERMES_FS_UID=$(_read_env_file_kv HERMES_FS_UID /opt/data/.env)
fi
HERMES_FS_UID=${HERMES_FS_UID:-10000}

HERMES_FS_GID=${HERMES_FS_GID:-}
if [ -z "$HERMES_FS_GID" ]; then
  HERMES_FS_GID=$(_read_env_file_kv HERMES_FS_GID /opt/data/.env)
fi
HERMES_FS_GID=${HERMES_FS_GID:-1001}

export HERMES_FS_UID HERMES_FS_GID

_ensure_shared_group_membership() {
  # The upstream entrypoint uses gosu hermes, which rebuilds supplementary groups
  # from /etc/group and can drop Docker's group_add. Make gid 1001 real here.
  [ "$(id -u)" = "0" ] || return 0
  id hermes >/dev/null 2>&1 || return 0

  _group_name=$(getent group "${HERMES_FS_GID}" 2>/dev/null | head -n 1 | cut -d: -f1)
  if [ -z "$_group_name" ]; then
    _group_name=hermeschat-shared
    groupadd -g "${HERMES_FS_GID}" "$_group_name" 2>/dev/null || true
    _group_name=$(getent group "${HERMES_FS_GID}" 2>/dev/null | head -n 1 | cut -d: -f1)
  fi
  [ -n "$_group_name" ] || return 0
  usermod -a -G "$_group_name" hermes 2>/dev/null || true
}

_repair_skill_tree() {
  _dir="$1"
  [ -d "$_dir" ] || return 0
  chown -R "${HERMES_FS_UID}:${HERMES_FS_GID}" "$_dir" 2>/dev/null || true
  chmod -R g+rwX "$_dir" 2>/dev/null || true
  find "$_dir" -type d -exec chmod g+s {} + 2>/dev/null || true
}

_repair_cron_tree() {
  [ -d /opt/data/cron ] || return 0
  chown -R "${HERMES_FS_UID}:${HERMES_FS_GID}" /opt/data/cron 2>/dev/null || true
  chmod -R g+rwX /opt/data/cron 2>/dev/null || true
  find /opt/data/cron -type d -exec chmod g+s {} + 2>/dev/null || true
  chmod 2770 /opt/data/cron 2>/dev/null || true
  [ -f /opt/data/cron/jobs.json ] && chmod 660 /opt/data/cron/jobs.json 2>/dev/null || true
}

_repair_skills_prompt_snapshot() {
  [ -f /opt/data/.skills_prompt_snapshot.json ] || return 0
  chown "${HERMES_FS_UID}:${HERMES_FS_GID}" /opt/data/.skills_prompt_snapshot.json 2>/dev/null || true
  chmod 660 /opt/data/.skills_prompt_snapshot.json 2>/dev/null || true
}

_ensure_shared_group_membership

_repair_codex_provider_auth() {
  [ -f /opt/data/auth.json ] || return 0
  _py=/opt/hermes/.venv/bin/python
  [ -x "$_py" ] || _py=python3
  "$_py" - <<'PY' 2>/dev/null || true
import json
from pathlib import Path

path = Path("/opt/data/auth.json")
try:
    data = json.loads(path.read_text())
except Exception:
    raise SystemExit

providers = data.setdefault("providers", {})
if not isinstance(providers, dict):
    providers = {}
    data["providers"] = providers

state = providers.get("openai-codex")
tokens = state.get("tokens") if isinstance(state, dict) else None
if isinstance(tokens, dict) and tokens.get("access_token") and tokens.get("refresh_token"):
    raise SystemExit

pool = data.get("credential_pool")
entries = pool.get("openai-codex") if isinstance(pool, dict) else None
if not isinstance(entries, list):
    raise SystemExit

entry = next(
    (
        e
        for e in entries
        if isinstance(e, dict)
        and e.get("access_token")
        and e.get("refresh_token")
        and str(e.get("auth_type") or "").lower() == "oauth"
    ),
    None,
)
if not entry:
    raise SystemExit

providers["openai-codex"] = {
    **(state if isinstance(state, dict) else {}),
    "tokens": {
        "access_token": entry["access_token"],
        "refresh_token": entry["refresh_token"],
    },
    "last_refresh": entry.get("last_status_at") or data.get("updated_at"),
    "auth_mode": "chatgpt",
}
path.write_text(json.dumps(data, indent=2) + "\n")
PY
}

if [ "${HERMES_AUTH_AUTOFIX:-1}" != "0" ]; then
  (
    while sleep 25; do
      [ -f /opt/data/auth.json ] || continue
      _repair_codex_provider_auth
      chown "${HERMES_FS_UID}:${HERMES_FS_GID}" /opt/data/auth.json 2>/dev/null || true
      chmod 640 /opt/data/auth.json 2>/dev/null || true
    done
  ) &
fi

if [ "${HERMES_SKILLS_AUTOFIX:-1}" != "0" ]; then
  (
    while sleep 60; do
      _repair_skill_tree /opt/data/skills
      _repair_skill_tree /opt/data/home/.skills
      _repair_skills_prompt_snapshot
      _repair_cron_tree
    done
  ) &
fi

if [ -d /opt/data/projects ]; then
  chown -R "${HERMES_FS_UID}:${HERMES_FS_GID}" /opt/data/projects || true
  chmod -R g+rwX /opt/data/projects || true
  find /opt/data/projects -type d -exec chmod g+s {} + 2>/dev/null || true
fi
# Cron jobs are written by the Hermes scheduler but read by HermesChat Settings.
# Keep them in the shared 10000:1001 shape so the chat app can list automations.
_repair_cron_tree
# Repo catalog skills + Hermes-created skills: must be writable by the gateway user (`hermes`).
# Bind mounts often inherit root:root from host edits/sync; without this, skill_manage patches fail
# and skills vanish from the session list (Hermes skips unreadable SKILL.md roots).
_repair_skill_tree /opt/data/skills
# User-scope skills tree (~/.skills in docs → /opt/data/home/.skills in this stack layout).
_repair_skill_tree /opt/data/home/.skills
# Session prompt snapshot lives next to skills; writable so the gateway can refresh after skill edits.
_repair_skills_prompt_snapshot
# HermesChat Builds: ./builds is a separate bind mount at /opt/data/builds (not only under hermes-data).
# Normalize like projects so the hermes user can write manifest.json and static apps on every fresh clone.
if [ -d /opt/data/builds ]; then
  chown -R "${HERMES_FS_UID}:${HERMES_FS_GID}" /opt/data/builds || true
  chmod -R g+rwX /opt/data/builds || true
  find /opt/data/builds -type d -exec chmod g+s {} + 2>/dev/null || true
fi
# HermesChat (gid 1001) reads auth.json via HERMES_DATA_DIR — need traverse on $HERMES_HOME and group-read on auth.json.
if [ -d /opt/data ]; then
  chown "${HERMES_FS_UID}:${HERMES_FS_GID}" /opt/data || true
  chmod 750 /opt/data || true
fi
if [ -f /opt/data/.env ]; then
  chown "${HERMES_FS_UID}:${HERMES_FS_GID}" /opt/data/.env || true
  chmod 640 /opt/data/.env || true
fi
if [ -f /opt/data/auth.json ]; then
  _repair_codex_provider_auth
  chown "${HERMES_FS_UID}:${HERMES_FS_GID}" /opt/data/auth.json || true
  chmod 640 /opt/data/auth.json || true
fi
exec /opt/hermes/docker/entrypoint.sh "$@"
