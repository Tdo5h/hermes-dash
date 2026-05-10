#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="hermes_dash_smoke"
CHAT_PORT="43100"
GATEWAY_PORT="48642"
DASHBOARD_PORT="49119"
BUILDS_PORT="48090"
DO_BUILD=0
DO_UP=0
DO_DOWN=0
INSTALL_OPEN_DESIGN=1

usage() {
  cat <<'USAGE'
Usage: scripts/smoke-test-isolated.sh [options]

Runs Hermes Dash from this checkout with isolated Docker names, ports, images,
networks, and volumes so it can coexist with a live Hermes stack on the same VPS.

Options:
  --build              Build the isolated stack.
  --up                 Build and start the isolated stack.
  --down               Stop and remove the isolated stack.
  --project NAME       Compose project name. Default: hermes_dash_smoke.
  --chat-port PORT     Host loopback port for chat. Default: 43100.
  --gateway-port PORT  Host loopback port for gateway. Default: 48642.
  --dashboard-port PORT
                       Host loopback port for dashboard. Default: 49119.
  --builds-port PORT   Host loopback port for published builds. Default: 48090.
  --no-open-design     Skip Open Design assets during setup.
  --with-open-design   Fetch Open Design assets during setup. This is the default.
  -h, --help           Show this help.

Typical pull test:
  git clone https://github.com/YOUR_GITHUB_USER/hermes-dash.git /root/hermes-dash-pull-test
  cd /root/hermes-dash-pull-test
  scripts/smoke-test-isolated.sh --up
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
    --down)
      DO_DOWN=1
      ;;
    --project)
      PROJECT="${2:-}"
      shift
      ;;
    --chat-port)
      CHAT_PORT="${2:-}"
      shift
      ;;
    --gateway-port)
      GATEWAY_PORT="${2:-}"
      shift
      ;;
    --dashboard-port)
      DASHBOARD_PORT="${2:-}"
      shift
      ;;
    --builds-port)
      BUILDS_PORT="${2:-}"
      shift
      ;;
    --with-open-design)
      INSTALL_OPEN_DESIGN=1
      ;;
    --no-open-design)
      INSTALL_OPEN_DESIGN=0
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

cat > docker-compose.smoke.yml <<EOF
services:
  postgres:
    container_name: ${PROJECT}-postgres

  hermes-bridge:
    image: ${PROJECT}-bridge:local
    container_name: ${PROJECT}-bridge

  hermes:
    image: ${PROJECT}-gateway:local
    container_name: ${PROJECT}-gateway
    ports: !override
      - "127.0.0.1:${GATEWAY_PORT}:8642"

  dashboard:
    image: ${PROJECT}-gateway:local
    container_name: ${PROJECT}-dashboard
    ports: !override
      - "127.0.0.1:${DASHBOARD_PORT}:9119"

  builds-static:
    container_name: ${PROJECT}-builds-static
    ports: !override
      - "127.0.0.1:${BUILDS_PORT}:80"

  chat:
    image: ${PROJECT}-chat:local
    container_name: ${PROJECT}-chat
    ports: !override
      - "127.0.0.1:${CHAT_PORT}:3100"

  shared-ingest-worker:
    image: ${PROJECT}-shared-ingest-worker:local
    container_name: ${PROJECT}-shared-ingest-worker

  caddy:
    container_name: ${PROJECT}-caddy

  cloudflared:
    container_name: ${PROJECT}-cloudflared
EOF

compose() {
  docker compose \
    --project-name "$PROJECT" \
    --profile chat \
    -f docker-compose.yml \
    -f docker-compose.smoke.yml \
    "$@"
}

if [ "$DO_DOWN" -eq 1 ]; then
  compose down --remove-orphans
  exit 0
fi

install_args=()
if [ "$INSTALL_OPEN_DESIGN" -eq 0 ]; then
  install_args+=(--no-open-design)
fi
scripts/install-hermes-integration.sh "${install_args[@]}"

export DOCKER_BUILDKIT=1
if [ "$DO_BUILD" -eq 1 ]; then
  compose build
fi

if [ "$DO_UP" -eq 1 ]; then
  compose up -d
  echo
  echo "Isolated Hermes Dash smoke stack:"
  echo "  Chat:      http://127.0.0.1:${CHAT_PORT}"
  echo "  Gateway:   http://127.0.0.1:${GATEWAY_PORT}/health"
  echo "  Dashboard: http://127.0.0.1:${DASHBOARD_PORT}"
  echo
  echo "Stop it with:"
  echo "  scripts/smoke-test-isolated.sh --down --project ${PROJECT}"
fi
