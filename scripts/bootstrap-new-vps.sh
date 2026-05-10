#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/YOUR_GITHUB_USER/hermes-dash.git"
BRANCH="main"
INSTALL_DIR="/opt/hermes-dash"
DASHBOARD_URL=""
INSTALL_DOCKER=1
RUN_UP=1

usage() {
  cat <<'USAGE'
Usage: bootstrap-new-vps.sh [options]

Fresh VPS bootstrap:
  1. Installs git + Docker if needed.
  2. Clones the Hermes Dash stack.
  3. Prepares runtime dirs and shared tokens.
  4. Builds and starts the chat profile.

Options:
  --repo URL          Git repository URL. Default: https://github.com/YOUR_GITHUB_USER/hermes-dash.git
  --branch NAME       Git branch. Default: main.
  --dir PATH          Install directory. Default: /opt/hermes-dash.
  --dashboard-url URL Public/tunnel URL for Hermes dashboard connect flow.
  --no-docker-install Skip package installation for Docker/git.
  --no-up             Prepare files only; do not docker compose up.
  -h, --help          Show this help.

Example:
  curl -fsSL https://raw.githubusercontent.com/YOUR_GITHUB_USER/hermes-dash/main/scripts/bootstrap-new-vps.sh \
    | bash -s -- --repo https://github.com/YOUR_GITHUB_USER/hermes-dash.git --dashboard-url https://dashboard.example.com
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      REPO_URL="${2:-}"
      shift
      ;;
    --branch)
      BRANCH="${2:-}"
      shift
      ;;
    --dir)
      INSTALL_DIR="${2:-}"
      shift
      ;;
    --dashboard-url)
      DASHBOARD_URL="${2:-}"
      shift
      ;;
    --no-docker-install)
      INSTALL_DOCKER=0
      ;;
    --no-up)
      RUN_UP=0
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

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo on a fresh VPS." >&2
  exit 1
fi

install_packages() {
  if command -v git >/dev/null 2>&1 && command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi
  if [ "$INSTALL_DOCKER" -ne 1 ]; then
    echo "Docker/git missing and --no-docker-install was set." >&2
    exit 1
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Automatic package install currently supports Debian/Ubuntu apt-get hosts." >&2
    exit 1
  fi

  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git python3 openssl docker.io docker-compose-plugin
  systemctl enable --now docker || true
}

install_packages

if [ -e "$INSTALL_DIR/.git" ]; then
  echo "repo exists: $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
elif [ -e "$INSTALL_DIR" ] && [ "$(find "$INSTALL_DIR" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  echo "install dir exists and is not empty: $INSTALL_DIR" >&2
  exit 1
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

install_args=()
if [ "$RUN_UP" -eq 1 ]; then
  install_args+=(--up)
fi
if [ -n "$DASHBOARD_URL" ]; then
  install_args+=(--dashboard-url "$DASHBOARD_URL")
fi

scripts/install-hermes-integration.sh "${install_args[@]}"

cat <<EOF

Fresh VPS bootstrap complete.

Next:
1. Open HermesChat setup:
   http://<your-vps-or-tunnel>/setup

2. Connect Codex / ChatGPT in the Hermes dashboard.
EOF

if [ -n "$DASHBOARD_URL" ]; then
  printf '   %s\n' "$DASHBOARD_URL"
else
  cat <<'EOF'
   If you did not expose the dashboard, use an SSH tunnel from your laptop:
   ssh -L 9119:127.0.0.1:9119 root@<your-vps-ip>
   Then open http://localhost:9119
EOF
fi

cat <<'EOF'

3. Optional voice:
   Add DEEPGRAM_API_KEY to .env, then restart chat.

OpenRouter is optional. Do not add an OpenRouter key unless you want extra
models or advanced provider routing.
EOF
