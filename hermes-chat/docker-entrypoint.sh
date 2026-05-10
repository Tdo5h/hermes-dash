#!/bin/sh
set -e
mkdir -p /var/hermes-chat/messages /var/hermes-chat/media/webchat
chown -R nextjs:nodejs /var/hermes-chat
# Vault upload staging (shared volume with hermes-bridge). Docker creates it root-owned; Chat must write UUID files here.
STAGING="${VAULT_STAGING_DIR:-/var/vault-staging}"
if [ -n "$STAGING" ]; then
  mkdir -p "$STAGING"
  chown -R nextjs:nodejs "$STAGING" || true
  chmod -R u+rwX,g+rwX "$STAGING" || true
fi
# Shared ingest job queue + mutex (HERMES_ARCHITECT_INGEST_COORD_DIR). Bind mounts are often root-owned.
COORD_DIR="${HERMES_ARCHITECT_INGEST_COORD_DIR:-}"
if [ -n "$COORD_DIR" ]; then
  mkdir -p "$COORD_DIR/jobs"
  chown -R nextjs:nodejs "$COORD_DIR" || true
  chmod -R u+rwX,g+rwX "$COORD_DIR" || true
fi
if [ -n "$DATABASE_URL" ]; then
  node /app/scripts/pg-bootstrap.mjs || true
fi
# Shared skill library. Hermes owns the files, HermesChat needs group write for
# pin/delete/edit actions and for the Curator usage sidecar.
if [ -d /opt/hermes-data/skills ]; then
  if touch /opt/hermes-data/skills/.hermeschat-permission-probe 2>/dev/null; then
    rm -f /opt/hermes-data/skills/.hermeschat-permission-probe
    chown -R 10000:1001 /opt/hermes-data/skills || true
    chmod -R g+rwX /opt/hermes-data/skills || true
    find /opt/hermes-data/skills -type d -exec chmod g+s {} + 2>/dev/null || true
    chmod 2775 /opt/hermes-data/skills || true
    [ -f /opt/hermes-data/skills/.usage.json ] && chmod 660 /opt/hermes-data/skills/.usage.json || true
  else
    echo "chat entrypoint: /opt/hermes-data/skills is read-only; skipping skill permission repair"
  fi
fi
# Hermes scheduler state (automations) is created by the gateway user and read by Chat.
# Normalize the cron folder when the mount is writable; read-only tenant mounts simply skip this.
if [ -d /opt/hermes-data/cron ]; then
  if touch /opt/hermes-data/cron/.hermeschat-permission-probe 2>/dev/null; then
    rm -f /opt/hermes-data/cron/.hermeschat-permission-probe
    chown -R 10000:1001 /opt/hermes-data/cron || true
    chmod -R g+rwX /opt/hermes-data/cron || true
    find /opt/hermes-data/cron -type d -exec chmod g+s {} + 2>/dev/null || true
    chmod 2770 /opt/hermes-data/cron || true
    [ -f /opt/hermes-data/cron/jobs.json ] && chmod 660 /opt/hermes-data/cron/jobs.json || true
  else
    echo "chat entrypoint: /opt/hermes-data/cron is read-only; skipping cron permission repair"
  fi
fi
# Project vault (see HERMES_PROJECTS_FS_ROOT) — owner 10000 (hermes) for agent writes; group 1001 (nextjs) for Chat.
# Numeric IDs: Chat image has no "hermes" user; gateway and chat must agree on 10000:1001.
if [ -d /vault-projects ]; then
  if touch /vault-projects/.hermeschat-permission-probe 2>/dev/null; then
    rm -f /vault-projects/.hermeschat-permission-probe
    chown -R 10000:1001 /vault-projects || true
    chmod -R g+rwX /vault-projects || true
    find /vault-projects -type d -exec chmod g+s {} + 2>/dev/null || true
  else
    echo "chat entrypoint: /vault-projects is read-only; skipping permission repair"
  fi
fi
# Published mini-apps (same bind mount as gateway /opt/data/builds). Agent-created dirs are often 755;
# without g+w on directories, nextjs cannot delete Creative / Builds entries (EACCES on unlink).
if [ -d /app/builds ]; then
  chown -R 10000:1001 /app/builds || true
  chmod -R g+rwX /app/builds || true
  find /app/builds -type d -exec chmod g+s {} + 2>/dev/null || true
fi
exec gosu nextjs "$@"
