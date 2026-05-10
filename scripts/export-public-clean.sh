#!/usr/bin/env bash
set -euo pipefail

SOURCE="/root/hermes-stack"
OUT="/root/hermes-public-export"
RUN_AUDIT=1

usage() {
  cat <<'USAGE'
Usage: scripts/export-public-clean.sh [options]

Builds a clean public repository tree from the live Hermes stack without
modifying the live stack. The export is allowlisted source/config plus a fresh
Hermes data skeleton; runtime data, secrets, personal vaults, device integrations,
and generated build output are intentionally left behind.

Options:
  --source PATH   Live Hermes stack to read from. Default: /root/hermes-stack
  --out PATH      Export directory to recreate. Default: /root/hermes-public-export
  --no-audit      Skip scripts/audit-public-clean.sh at the end.
  -h, --help      Show this help.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source)
      SOURCE="${2:-}"
      shift
      ;;
    --out)
      OUT="${2:-}"
      shift
      ;;
    --no-audit)
      RUN_AUDIT=0
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

SELF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$(cd "$SOURCE" && pwd)"
OUT_PARENT="$(mkdir -p "$(dirname "$OUT")" && cd "$(dirname "$OUT")" && pwd)"
OUT="$OUT_PARENT/$(basename "$OUT")"

case "$OUT" in
  /|"$SOURCE"|"$SELF_ROOT"|/root|/opt|/root/hermes-stack)
    echo "refusing unsafe export path: $OUT" >&2
    exit 1
    ;;
esac

if [ ! -d "$SOURCE/hermes-chat/app" ]; then
  echo "source does not look like a Hermes stack: $SOURCE" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

copy_dir() {
  local rel="$1"
  if [ -d "$SOURCE/$rel" ]; then
    mkdir -p "$(dirname "$OUT/$rel")"
    rsync -a --delete \
      --exclude 'node_modules' \
      --exclude '__pycache__' \
      --exclude '*.pyc' \
      "$SOURCE/$rel/" "$OUT/$rel/"
  fi
}

copy_file() {
  local rel="$1"
  if [ -f "$SOURCE/$rel" ]; then
    mkdir -p "$(dirname "$OUT/$rel")"
    cp "$SOURCE/$rel" "$OUT/$rel"
  fi
}

copy_self_file() {
  local rel="$1"
  if [ -f "$SELF_ROOT/$rel" ]; then
    mkdir -p "$(dirname "$OUT/$rel")"
    cp "$SELF_ROOT/$rel" "$OUT/$rel"
  fi
}

copy_self_dir() {
  local rel="$1"
  if [ -d "$SELF_ROOT/$rel" ]; then
    mkdir -p "$(dirname "$OUT/$rel")"
    rsync -a --delete "$SELF_ROOT/$rel/" "$OUT/$rel/"
  fi
}

copy_dir "chat"
copy_dir "caddy"
copy_dir "builds-static"
copy_dir "hermes-bridge"
copy_dir "postgres"
copy_dir "shared-ingest-worker"
copy_file "hermes-agent.Dockerfile"
copy_file "gateway-entrypoint.sh"

rsync -a --delete \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.next' \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude 'builds' \
  --exclude '.cursor' \
  --exclude '.theme-backup-*' \
  --exclude 'tsconfig.tsbuildinfo' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  "$SOURCE/hermes-chat/" "$OUT/hermes-chat/"

find "$OUT/hermes-chat" -maxdepth 1 -type f -name '*.md' \
  ! -name 'README.md' ! -name 'SETUP.md' ! -name 'AGENTS.md' -delete
rm -f "$OUT/hermes-chat/scripts/deploy.sh"

for rel in \
  "chat/Dockerfile" \
  "hermes-bridge/Dockerfile" \
  "shared-ingest-worker/Dockerfile" \
  "hermes-chat/package.json" \
  "hermes-chat/package-lock.json" \
  "hermes-chat/app/setup/page.tsx" \
  "hermes-chat/app/api/setup/status/route.ts" \
  "hermes-chat/lib/setup-status.ts"
do
  copy_self_file "$rel"
done

mkdir -p "$OUT/patches"
for patch in \
  gateway_run.py \
  api_server.py \
  cron_scheduler.py \
  cron_jobs.py \
  skill_usage.py \
  skills_sync.py \
  openrouter_sidecar_accounting.py \
  openrouter_image_helpers.py \
  image_generation_tool.py \
  image_edit_tool.py \
  file_operations.py \
  workspace_knowledge_tool.py \
  toolsets.py \
  hermes_cli_config.py \
  hermes_cli_tools_config.py \
  smart_model_routing.py
do
  cp "$SOURCE/patches/$patch" "$OUT/patches/$patch"
done

cat > "$OUT/patches/README.md" <<'EOF'
# HermesChat Gateway Patches

These modules are mounted read-only over the upstream Hermes container so the
web chat can use the gateway, vault ingest, Create Studio, skill management, and
shared workspace flows consistently.

The public base stack does not ship personal device integrations. Add local
tools as optional patches in your own deployment if you need them.
EOF

mkdir -p "$OUT/scripts"
for script in \
  audit-public-clean.sh \
  bootstrap-new-vps.sh \
  export-public-clean.sh \
  install-chat-on-existing-hermes.sh \
  install-hermes-integration.sh \
  make-clean-history-repo.sh \
  replace-repo-with-public-clean.sh \
  smoke-test-isolated.sh \
  verify-hermes-integration-patches.sh
do
  copy_self_file "scripts/$script"
done

cat > "$OUT/.gitignore" <<'EOF'
.env
.env.*
!.env.example
node_modules/
.next/
dist/
coverage/
*.tsbuildinfo
__pycache__/
*.pyc

builds/*
!builds/manifest.json
!builds/__hermes_mobile_chrome.js

hermes-data/.env
hermes-data/auth.json
hermes-data/auth.lock
hermes-data/*.db
hermes-data/*.db-shm
hermes-data/*.db-wal
hermes-data/cache/
hermes-data/checkpoints/
hermes-data/home/
hermes-data/logs/
hermes-data/memories/
hermes-data/open-design/
hermes-data/projects/
hermes-data/sandboxes/
hermes-data/sessions/
hermes-data/tool_images/
hermes-data/workspace/
environments/*/data/
EOF

cat > "$OUT/.dockerignore" <<'EOF'
.git
.env
.env.*
node_modules
**/node_modules
.next
**/.next
hermes-data/auth.json
hermes-data/*.db
hermes-data/cache
hermes-data/checkpoints
hermes-data/home
hermes-data/logs
hermes-data/memories
hermes-data/open-design/.git
hermes-data/projects
hermes-data/sandboxes
hermes-data/sessions
hermes-data/tool_images
hermes-data/workspace
EOF

cat > "$OUT/.env.example" <<'EOF'
# Stack root: copy to .env next to docker-compose.yml.

# Required. install-hermes-integration.sh generates this when blank and mirrors it
# to hermes-data/.env as API_SERVER_KEY.
HERMES_TOKEN=

# Optional public/tunnel URL for the Hermes dashboard connect flow.
# HERMES_DASHBOARD_URL=https://dashboard.example.com

# Hermes Dash is a single-owner stack; this lets the UI save model/profile and
# automation changes through the authenticated local gateway.
HERMES_ALLOW_STACK_MODEL_EDITS=1

# Optional voice. Chat/Create work without this; it only enables microphone
# dictation and read-aloud.
# DEEPGRAM_API_KEY=

# Optional extra providers/routing. The default path is Codex / ChatGPT connected
# from the Hermes dashboard.
# OPENROUTER_API_KEY=
# OPENROUTER_MANAGEMENT_KEY=

# Optional public URLs.
# NEXT_PUBLIC_SITE_URL=https://chat.example.com
# BUILDS_BASE_URL=https://apps.example.com

# Optional Cloudflare Tunnel container.
# CLOUDFLARE_TUNNEL_TOKEN=

# Optional ownership override for shared files.
# HERMES_FS_UID=10000
# HERMES_FS_GID=1001
EOF

mkdir -p \
  "$OUT/builds" \
  "$OUT/environments/business-test/data/shared-ingest/coord" \
  "$OUT/environments/business-test/data/shared-wiki" \
  "$OUT/hermes-data/cron/output" \
  "$OUT/hermes-data/skills" \
  "$OUT/hermes-data/memories" \
  "$OUT/docs"

printf '{\n  "apps": []\n}\n' > "$OUT/builds/manifest.json"
printf '{\n  "jobs": []\n}\n' > "$OUT/hermes-data/cron/jobs.json"
if [ -f "$SOURCE/builds/__hermes_mobile_chrome.js" ]; then
  cp "$SOURCE/builds/__hermes_mobile_chrome.js" "$OUT/builds/__hermes_mobile_chrome.js"
fi

cat > "$OUT/hermes-data/.gitignore" <<'EOF'
.env
auth.json
auth.lock
*.db
*.db-shm
*.db-wal
cron/jobs.json
cache/
checkpoints/
home/
logs/
memories/*
!memories/.gitkeep
open-design/
projects/
sandboxes/
sessions/
tool_images/
workspace/
EOF

cat > "$OUT/hermes-data/.env.example" <<'EOF'
# Hermes gateway home: copy to hermes-data/.env.
# API_SERVER_KEY must match HERMES_TOKEN in the stack root .env.
API_SERVER_KEY=

# Optional ownership override for shared files.
# HERMES_FS_UID=10000
# HERMES_FS_GID=1001
EOF

cat > "$OUT/hermes-data/SOUL.md" <<'EOF'
# Hermes

You are Hermes, a practical local assistant connected to HermesChat. Help the
user work with their files, vaults, Create Studio outputs, automations, and
research in a careful, transparent way.
EOF

cat > "$OUT/hermes-data/memories/USER.md" <<'EOF'
# User

This is a fresh HermesChat install. Add durable preferences here after setup.
EOF
touch "$OUT/hermes-data/memories/.gitkeep"

cat > "$OUT/hermes-data/config.yaml" <<'EOF'
model:
  default: gpt-5.5
  provider: openai-codex
  base_url: https://chatgpt.com/backend-api/codex
providers: {}
fallback_providers: []
credential_pool_strategies: {}
toolsets:
  - hermes-cli
agent:
  max_turns: 60
  gateway_timeout: 1800
  restart_drain_timeout: 60
  api_max_retries: 3
  service_tier: fast
  tool_use_enforcement: auto
  gateway_timeout_warning: 900
  gateway_notify_interval: 600
  request_overrides:
    temperature: 0.2
    max_tokens: 24576
  reasoning_effort: xhigh
terminal:
  backend: local
  modal_mode: auto
  cwd: .
  timeout: 180
  env_passthrough: []
  shell_init_files: []
  auto_source_bashrc: true
  docker_image: nikolaik/python-nodejs:python3.11-nodejs20
  docker_forward_env: []
  docker_env: {}
  singularity_image: docker://nikolaik/python-nodejs:python3.11-nodejs20
  modal_image: nikolaik/python-nodejs:python3.11-nodejs20
  daytona_image: nikolaik/python-nodejs:python3.11-nodejs20
  container_cpu: 1
  container_memory: 5120
  container_disk: 51200
  container_persistent: true
  docker_volumes: []
  docker_mount_cwd_to_workspace: false
  persistent_shell: true
browser:
  inactivity_timeout: 120
  command_timeout: 60
  record_sessions: false
  allow_private_urls: false
  cdp_url: ''
  camofox:
    managed_persistence: false
  cloud_provider: browser-use
  use_gateway: false
checkpoints:
  enabled: true
  max_snapshots: 50
file_read_max_chars: 100000
compression:
  enabled: true
  threshold: 0.5
  target_ratio: 0.2
  protect_last_n: 20
display:
  compact: false
  personality: kawaii
  resume_display: full
  busy_input_mode: interrupt
  bell_on_complete: false
  show_reasoning: false
  streaming: false
  final_response_markdown: strip
  inline_diffs: true
  show_cost: false
  skin: default
  interim_assistant_messages: false
  tool_progress_command: false
  tool_progress_overrides: {}
  tool_preview_length: 0
  platforms: {}
dashboard:
  theme: default
privacy:
  redact_pii: false
tts:
  provider: openai
  use_gateway: false
stt:
  enabled: true
  provider: local
EOF

for skill in creative-studio pdf-generation-pymupdf project-vault shared-wiki-vault-io; do
  rsync -a --delete \
    --exclude '.hub' \
    --exclude '.usage.json' \
    --exclude '.usage.json.lock' \
    --exclude '.curator_state' \
    "$SOURCE/hermes-data/skills/$skill/" "$OUT/hermes-data/skills/$skill/"
done

find "$OUT/hermes-data/skills/creative-studio" -path '*/references/*.md' -type f -delete

cat > "$OUT/hermes-chat/lib/thinking-headline.ts" <<'EOF'
import { canonicalActivityLabelMatch } from "@/lib/hermes-sse-stream";

const ORB_FALLBACK_MAX = 48;

function isGenericIdle(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  const k = t.toLowerCase().replace(/…/g, "...");
  return k === "thinking" || k === "working..." || k === "working" || k === "working…";
}

export function shortThinkingLabel(raw: string): string {
  const s = raw.trim();
  if (!s) return "Working…";
  const lower = s.toLowerCase();
  if (lower.includes("search") && lower.includes("web")) return "Searching the web";
  if (lower.includes("web_extract") || (lower.includes("read") && lower.includes("page"))) return "Reading page";
  if (lower.includes("browser") || lower.includes("brows")) return "Browsing";
  if (lower.includes("terminal") || lower.includes("command")) return "Running command";
  if (lower.includes("execute_code") || lower.includes("running code")) return "Running code";
  if (lower.includes("write_file") || lower.includes("writing file")) return "Writing file";
  if (lower.includes("read_file") || lower.includes("reading file")) return "Reading file";
  if (lower.includes("search_files")) return "Searching files";
  if (lower.includes("memory")) return "Updating memory";
  if (lower.includes("vision") || lower.includes("analyzing image")) return "Analyzing image";
  if (lower.includes("image_edit") || lower.includes("editing image")) return "Editing image";
  if (lower.includes("image_generate") || lower.includes("generating image")) return "Generating image";
  if (lower.includes("delegate")) return "Delegating task";
  if (lower.includes("skills_list") || lower.includes("listing skills")) return "Listing skills";
  if (lower.includes("skill_view") || lower === "skill view") return "Reading a skill";
  if (lower.includes("skill_manage") || lower.includes("updating skills")) return "Updating skills";
  if (lower.includes("mcp")) return "Calling tool";
  if (lower.includes("writing reply") || lower.includes("composing") || (lower.includes("reply") && lower.includes("writing"))) return "Writing reply";
  if (lower === "thinking" || lower.startsWith("thinking")) return "Thinking";
  if (s.length > 48) return `${s.slice(0, 45)}…`;
  return s;
}

export function compactThinkingSummary(statusText: string): string {
  const raw = statusText.trim();
  if (isGenericIdle(raw)) return "Thinking";
  const fromRaw = canonicalActivityLabelMatch(raw);
  if (fromRaw) return fromRaw;
  const short = shortThinkingLabel(statusText);
  if (isGenericIdle(short)) return "Thinking";
  const fromShort = canonicalActivityLabelMatch(short);
  if (fromShort) return fromShort;
  const shortNorm = short.replace(/\s+/g, " ").trim();
  if (shortNorm.length <= ORB_FALLBACK_MAX) return shortNorm;
  return `${shortNorm.slice(0, ORB_FALLBACK_MAX - 1)}…`;
}
EOF

cat > "$OUT/hermes-chat/lib/deepgram-nz-bop-keyterms.ts" <<'EOF'
export const DEEPGRAM_NZ_BOP_KEYTERMS: string[] = [];
EOF

cp "$SOURCE/docker-compose.yml" "$OUT/docker-compose.yml"

python3 - "$OUT" "$SOURCE" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
source = Path(sys.argv[2])
base_patches = {
    "gateway_run.py",
    "api_server.py",
    "cron_scheduler.py",
    "cron_jobs.py",
    "skill_usage.py",
    "skills_sync.py",
    "openrouter_sidecar_accounting.py",
    "openrouter_image_helpers.py",
    "image_generation_tool.py",
    "image_edit_tool.py",
    "file_operations.py",
    "workspace_knowledge_tool.py",
    "toolsets.py",
    "hermes_cli_config.py",
    "hermes_cli_tools_config.py",
    "smart_model_routing.py",
}

excluded_tokens = []
source_patches = source / "patches"
for path in source_patches.glob("*.py"):
    if path.name not in base_patches and path.name.endswith("_tool.py"):
        stem = path.stem.removesuffix("_tool")
        excluded_tokens.append(stem)
        excluded_tokens.extend(stem.split("_"))
excluded_tokens = sorted(set(excluded_tokens), key=len, reverse=True)

compose = root / "docker-compose.yml"
text = compose.read_text()
text = re.sub(r"\n  mqtt:\n(?:(?!\n  [A-Za-z0-9_-]+:\n).)*(?=\n  [A-Za-z0-9_-]+:\n)", "\n", text, flags=re.S)
text = re.sub(r"\n    depends_on:\n      mqtt:\n        condition: service_started", "", text)
allowed_patch_mounts = {f"./patches/{name}:" for name in base_patches}
filtered = []
for line in text.splitlines():
    stripped = line.strip()
    if stripped.startswith("#"):
        continue
    if "mqtt_data:" in line:
        continue
    if "- ./patches/" in line and not any(token in line for token in allowed_patch_mounts):
        continue
    filtered.append(line)
text = "\n".join(filtered)
text = re.sub(r"NEXT_PUBLIC_SITE_URL: \$\{NEXT_PUBLIC_SITE_URL:-[^}]+\}", "NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL:-http://localhost:3100}", text)
text = re.sub(r"BUILDS_BASE_URL: \$\{BUILDS_BASE_URL:-[^}]+\}", "BUILDS_BASE_URL: ${BUILDS_BASE_URL:-http://localhost:8090}", text)
text = re.sub(r"INGEST_WORKER_MAIN_SITE_URL: \$\{NEXT_PUBLIC_SITE_URL:-[^}]+\}", "INGEST_WORKER_MAIN_SITE_URL: ${NEXT_PUBLIC_SITE_URL:-http://localhost:3100}", text)
text = text.replace("HERMES_ALLOW_STACK_MODEL_EDITS: ${HERMES_ALLOW_STACK_MODEL_EDITS:-0}", "HERMES_ALLOW_STACK_MODEL_EDITS: ${HERMES_ALLOW_STACK_MODEL_EDITS:-1}")
if "HERMES_DASHBOARD_URL:" not in text:
    text = text.replace(
        "      HERMES_ALLOW_STACK_MODEL_EDITS: ${HERMES_ALLOW_STACK_MODEL_EDITS:-1}\n",
        "      HERMES_ALLOW_STACK_MODEL_EDITS: ${HERMES_ALLOW_STACK_MODEL_EDITS:-1}\n      HERMES_DASHBOARD_URL: ${HERMES_DASHBOARD_URL:-}\n",
    )
compose.write_text(text.rstrip() + "\n")

dockerfile = root / "chat/Dockerfile"
if dockerfile.exists():
    s = dockerfile.read_text()
    s = re.sub(r"ARG NEXT_PUBLIC_SITE_URL=.*", "ARG NEXT_PUBLIC_SITE_URL=http://localhost:3100", s)
    dockerfile.write_text(s)

layout = root / "hermes-chat/app/layout.tsx"
if layout.exists():
    s = layout.read_text()
    s = re.sub(r'process\.env\.NEXT_PUBLIC_SITE_URL\?\.replace\(/\\/\$/, ""\) \|\|\n  "[^"]+"', 'process.env.NEXT_PUBLIC_SITE_URL?.replace(/\\/$/, "") ||\n  "http://localhost:3100"', s)
    layout.write_text(s)

labels = root / "hermes-chat/lib/hermes-sse-stream.ts"
if labels.exists():
    s = labels.read_text()
    allowed = {
        "web_search", "web_extract", "browser_navigate", "read_file", "write_file",
        "search_files", "terminal", "execute_code", "memory", "vision_analyze",
        "image_generate", "image_edit", "delegate_task", "mcp_call", "skills_list",
        "skill_view", "skill_manage",
    }
    out = []
    in_map = False
    for line in s.splitlines():
        stripped = line.strip()
        if stripped.startswith("export const TOOL_LABELS"):
            in_map = True
            out.append(line)
            continue
        if in_map and stripped == "};":
            in_map = False
            out.append(line)
            continue
        if in_map:
            m = re.match(r"([A-Za-z0-9_]+):", stripped)
            if m and m.group(1) not in allowed:
                continue
        out.append(line)
    labels.write_text("\n".join(out) + "\n")

display_name = root / "hermes-chat/lib/agent-display-name.ts"
if display_name.exists():
    s = display_name.read_text()
    s = re.sub(r"// Preserve all-caps handles.*", "// Preserve all-caps handles instead of title-casing them.", s)
    display_name.write_text(s)

shared = root / "hermes-data/skills/shared-wiki-vault-io/SKILL.md"
if shared.exists():
    lines = shared.read_text().splitlines()
    out = []
    skipping = False
    for line in lines:
        if line.startswith("In **this** stack,"):
            skipping = True
            continue
        if skipping and not line.strip():
            out.append("In this stack, shared workspaces may be mounted at `/vault-shared/...`. Prefer explicit absolute paths when the prompt or workspace profile supplies them.")
            out.append("")
            skipping = False
            continue
        if not skipping:
            out.append(line)
    shared.write_text("\n".join(out).rstrip() + "\n")

rig = root / "hermes-data/skills/creative-studio/research-backed-image-generation/SKILL.md"
if rig.exists():
    s = rig.read_text()
    s = re.sub(
        r"   - Derive monogram initials.*?\n",
        "   - Derive monogram initials from the user's final requested brand name, not from a prior render or legacy name.\n",
        s,
    )
    rig.write_text(s)

def remove_dict_entry(text: str, key: str) -> str:
    key_norm = re.sub(r"[^a-z0-9]+", "", key.lower())
    lines = text.splitlines()
    out = []
    i = 0
    while i < len(lines):
        m = re.match(r'    "([^"]+)": \{', lines[i])
        m_norm = re.sub(r"[^a-z0-9]+", "", m.group(1).lower()) if m else ""
        if m and key_norm and key_norm in m_norm:
            depth = 0
            while i < len(lines):
                depth += lines[i].count("{")
                depth -= lines[i].count("}")
                line = lines[i]
                i += 1
                if depth <= 0 and line.strip().endswith("},"):
                    break
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out) + "\n"

def remove_try_import_block(text: str, token: str) -> str:
    return re.sub(
        rf"\ntry:\n    import tools\.{re.escape(token)}_tool[^\n]*\nexcept Exception:\n    pass\n",
        "\n",
        text,
    )

def scrub_excluded_line(line: str, tokens: list[str]) -> str | None:
    out = line
    for token in tokens:
        token_norm = re.sub(r"[^a-z0-9]+", "", token.lower())
        if not token_norm:
            continue
        out = re.sub(rf'"[^"]*{re.escape(token)}[^"]*",?\s*', "", out, flags=re.I)
        norm = re.sub(r"[^a-z0-9]+", "", out.lower())
        if token_norm in norm:
            return None
    out = re.sub(r",\s*,", ",", out)
    out = re.sub(r"\[\s*,\s*", "[", out)
    out = re.sub(r",\s*\]", "]", out)
    if out.strip() in {"", "[],", "[]"}:
        return None
    return out

for rel in ["patches/toolsets.py", "patches/hermes_cli_tools_config.py", "patches/cron_scheduler.py"]:
    path = root / rel
    if not path.exists():
        continue
    s = path.read_text()
    for token in excluded_tokens:
        s = remove_dict_entry(s, token)
        s = remove_try_import_block(s, token)
    cleaned = []
    for line in s.splitlines():
        new_line = scrub_excluded_line(line, excluded_tokens)
        if new_line is not None:
            cleaned.append(new_line)
    s = "\n".join(cleaned) + "\n"
    s = re.sub(
        r"\n        # Legacy safety:.*?\n        enabled_toolsets -= default_off",
        "\n        enabled_toolsets -= default_off",
        s,
        flags=re.S,
    )
    s = re.sub(r"\n        if in default_off.*?\n", "\n", s)
    s = re.sub(r"\n            default_off\.remove\(\)\n", "\n", s)
    path.write_text(s)

for rel in ["hermes-chat/app/api/sessions/generate-title/route.ts", "hermes-chat/app/api/chat/send/route.ts"]:
    path = root / rel
    if path.exists():
        s = path.read_text()
        s = re.sub(
            r"Good style: .*? Bad style:",
            "Good style: Image Routing Fix, Timesheet Workflow Repair, Chat Divider Design. Bad style:",
            s,
        )
        path.write_text(s)
PY

find "$OUT" \( -type d -name node_modules -o -type d -name __pycache__ \) -prune -exec rm -rf {} +
find "$OUT" -type f -name '*.pyc' -delete

cat > "$OUT/README.md" <<'EOF'
# Hermes Dash

Hermes Dash is a clean public distribution of HermesChat running on top of
Hermes in Docker. It includes the web chat, vault/file ingest, Create Studio,
published Builds, shared workspace wiring, and the gateway patches needed for
the app to work as one stack.

The supported default provider path is OpenAI Codex / ChatGPT through the Hermes
dashboard. Deepgram is optional and only enables voice. OpenRouter is optional
for extra providers or routing, but it does not replace the tested Codex /
ChatGPT first-run path yet.

Other Hermes provider logins, including Anthropic, Claude Code, Nous, Qwen, and
MiniMax, may appear in the dashboard. Hermes Dash does not currently treat them
as equivalent setup-complete providers because chat, Create, image, and web-view
flows are tested end to end with Codex / ChatGPT first. Contributions that make
those providers first-class are welcome.

Create Studio uses Open Design as its primary design reference library. The
installer fetches it into `hermes-data/open-design` by default so Design DNA,
email, frame, and motion creation flows have the same references as the main
HermesChat stack.

## Fresh VPS

```bash
git clone https://github.com/YOUR_ORG/hermes-dash.git /opt/hermes-dash
cd /opt/hermes-dash
scripts/install-hermes-integration.sh --up
```

Then open `/setup` in HermesChat and connect Codex / ChatGPT from the Hermes
dashboard.

## Existing Hermes VPS

Use `scripts/install-chat-on-existing-hermes.sh` only after reading the warning
in `docs/PUBLISHING_HERMES_CHAT.md`. HermesChat changes the stack shape because
it adds the web app, shared vault ingest, Create Studio assets, and mounted
gateway patches.
EOF

cat > "$OUT/docs/PUBLISHING_HERMES_CHAT.md" <<'EOF'
# Publishing Hermes Dash

This public repo is generated from a live HermesChat stack through
`scripts/export-public-clean.sh`. The exporter is allowlist based: it copies
source code and generic setup files, then creates a fresh `hermes-data` skeleton.
It does not copy secrets, sessions, logs, personal vaults, local devices, or
runtime databases.

## Fresh install flow

```bash
git clone https://github.com/YOUR_ORG/hermes-dash.git /opt/hermes-dash
cd /opt/hermes-dash
scripts/install-hermes-integration.sh --up
```

Open HermesChat `/setup`, then use the dashboard link to connect Codex /
ChatGPT. Add `DEEPGRAM_API_KEY` to `.env` only if you want voice.

## Existing Hermes flow

For users who already run Hermes, install into a separate directory first. This
stack uses mounted gateway patches and a web-facing data layout, so treat it as
a stack migration rather than a tiny theme install.

## Public cleanup checks

Before pushing:

```bash
scripts/audit-public-clean.sh .
scripts/verify-hermes-integration-patches.sh
```

For a private local audit, set `HERMES_PUBLIC_PRIVATE_TERMS` to a regular
expression containing terms that must never appear in the public repo, then run
the audit again.
EOF

if [ "$RUN_AUDIT" -eq 1 ]; then
  "$OUT/scripts/audit-public-clean.sh" "$OUT"
fi

printf 'Clean public export written to %s\n' "$OUT"
