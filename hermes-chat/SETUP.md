# HermesChat — Setup

HermesChat is a Next.js UI that talks to the **Hermes** OpenAI-compatible API. **Models, tools, and provider keys are configured in Hermes** (`hermes-data/.env`, `config.yaml`). Chat history is stored in **`HERMES_CHAT_DATA_DIR`** on the app server.

## Docker (recommended on a VPS)

From the repo that contains `docker-compose.yml` (e.g. `hermes-stack`):

1. At the **stack root** (next to `docker-compose.yml`), create **`.env`** from **`.env.example`** (see also **[GREENFIELD.md](../GREENFIELD.md)**) and set **`HERMES_TOKEN`** to the **exact same value** as **`API_SERVER_KEY`** in `hermes-data/.env`. The `chat` service loads **`./.env`** and mounts it as `/app/.env.local`.
2. Copy or mirror the same file into **`hermes-chat/.env`** and **`hermes-chat/.env.local`** so local `npm run dev` matches Docker (`cp ../.env .env.local` from `hermes-chat/` after editing the root file).
3. Set **`CHAT_MODEL`** if you want a specific default model id sent in requests (Hermes may still apply its own routing).
4. Start Hermes, then the chat UI (first run; builds all profile images that have a `build:`):

   ```bash
   export DOCKER_BUILDKIT=1
   docker compose --profile chat up -d --build
   ```

   For **HermesChat-only** code changes after the stack is up, prefer **`docker compose --profile chat build chat`** then **`docker compose --profile chat up -d chat`** so gateway and bridge are not rebuilt unnecessarily.

5. Optional: with the **`edge`** profile, Caddy serves the app on port 80.

The `chat` service sets **`HERMES_CHAT_DATA_DIR=/var/hermes-chat`** and mounts a named volume so sessions survive image rebuilds.

The **chat image entrypoint** runs once as root (before `node`): it creates `messages/` under that path and **`chown`s the volume to `nextjs:nodejs`** (uid/gid 1001). The app process still runs as `nextjs`. Without this, Docker’s named volume is often root-owned and the first message fails with **`EACCES`** on `mkdir`—and **Hermes is never called** because saving the session happens before the gateway request.

### Environment variables (chat container)

| Variable | Purpose |
|----------|---------|
| `HERMES_URL` | Hermes API base (e.g. `http://hermes:8642`) |
| `HERMES_TOKEN` | Bearer token (same as Hermes `API_SERVER_KEY`) |
| `CHAT_MODEL` | Model id string for requests (default `hermes-agent` if unset) |
| `HERMES_CHAT_DATA_DIR` | App data: `sessions.json` and `messages/*.json` |
| `PUSH_WEBHOOK_TOKEN` | Optional Bearer for `POST /api/push/send` |
| `OPENROUTER_API_KEY` | Rare; only for optional client features that call OpenRouter directly (not required when Hermes uses `provider: nous`) |
| `AGENT_DISPLAY_NAME` | Optional; assistant name in the UI (“I’m …”), push notification copy, and optional gateway `X-Title` (default `Hermes`) |

Legacy aliases **`OPENCLAW_URL`** / **`OPENCLAW_TOKEN`** are still read by the app if `HERMES_*` is unset.

## Local development

```bash
cd hermes-chat
cp .env.example .env.local
# Set HERMES_URL, HERMES_TOKEN, optionally HERMES_CHAT_DATA_DIR — or copy stack root: cp ../.env .env.local
npm install
npm run dev
```

Open `http://localhost:3100`.

## Push notifications (optional)

Generate VAPID keys (`npx web-push generate-vapid-keys`) and set `VAPID_*` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the same env file you use for chat (stack **`.env`** and/or **`hermes-chat/.env.local`**) — see variables in the stack **`.env.example`** or **`hermes-chat/.env.example`**.

## Portable cron → HermesChat (“cronchats”)

These requirements apply when you copy this app to another host or container and reinstall **stock Hermes** next to it:

- **One Hermes cron job → one HermesChat thread.** The webhook body must include the **same stable `jobId`** (Hermes job id) on every run so messages append to the same `cron-<slug>` session.
- **Gateway must deliver over HTTP** to HermesChat. Hermes uses the job’s **`deliver`** field with a **`webhook:`** prefix (see the Hermes docs for cron delivery). See the agent skill **`hermes-cron-hermeschat`** in `skills/` and `hermes-data/skills/devops/hermes-cron-hermeschat/`.
- **`deliver` format:** `webhook:http://HOST:3100/api/push/send` — always use the **`webhook:`** prefix. A bare `http://…` is parsed incorrectly by Hermes (first `:` splits platform vs URL).
- **Docker:** From the **gateway** container, use the compose **service name** for HermesChat (e.g. `webhook:http://chat:3100/api/push/send` on `hermes-net`). **`127.0.0.1:3100`** from inside `hermes` points at the gateway container itself, not the `chat` container.
- **Optional auth:** If **`PUSH_WEBHOOK_TOKEN`** is set in the stack `.env`, the gateway must send `Authorization: Bearer <same token>` on the outbound POST (or leave the token unset on trusted internal networks).

**Copy-paste checks**

```bash
# From the host (chat published on loopback)
curl -sS -X POST "http://127.0.0.1:3100/api/push/send" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PUSH_WEBHOOK_TOKEN" \
  -d '{"jobId":"smoke-test","summary":"ping"}'   # omit Authorization if PUSH_WEBHOOK_TOKEN is unset

# From inside the Hermes gateway container (Docker)
docker exec hermes-gateway wget -qO- \
  --post-data='{"jobId":"smoke-test","summary":"ping"}' \
  --header='Content-Type: application/json' \
  http://chat:3100/api/push/send
```

**Verify webhook support in the Hermes image** (optional): `docker exec hermes-gateway grep -n platform_map /opt/hermes/cron/scheduler.py` — the image must include **`webhook`** in the same map used by `_deliver_result`. A build that lists `webhook` in `_KNOWN_DELIVERY_PLATFORMS` but **omits** it from `platform_map` will report **unknown platform** / **not-delivered** for `deliver: webhook:http://…` until upgraded or patched upstream ([hermes-agent#4386](https://github.com/NousResearch/hermes-agent/issues/4386)).

## Cron → chat webhook

**Visible tab:** the service worker intentionally skips the **system notification** when a window for this origin is already visible (so you are not spammed while using the app). The webhook still runs; after a deploy with the current app, an open HermesChat tab also **refreshes the sidebar and transcript** when a push arrives. If you need a banner with the app open, switch to another tab or rely on the updated cron thread in the sidebar.

`POST /api/push/send` accepts cron-style payloads and appends messages to a deterministic session (e.g. `cron-<slug>`). Recognized shapes:

- Legacy: `{ "message": "…", "name": "optional" }` (no `title`).
- Hermes-style: `{ "jobId": "…", "summary": "…" }` — also accepts **`job_id`**, and **`message`** / **`text`** instead of **`summary`** when paired with a job id.

If **`PUSH_WEBHOOK_TOKEN`** is set, send `Authorization: Bearer <token>`.

## Troubleshooting

**EACCES on `/var/hermes-chat` (could not save session / mkdir `messages`)** — The chat container runs as user `nextjs` (uid 1001). The named volume must be writable after the image **entrypoint** `chown`s it. Rebuild/restart the `chat` service so you have the current Dockerfile entrypoint. This is **filesystem** permissions only; fixing it does not fix HTTP 401 from Hermes.

**401 / “Missing Authentication header” from Hermes** — The gateway expects `Authorization: Bearer <key>`. Set **`HERMES_TOKEN`** in the stack **`.env`** and **`hermes-chat/.env.local`** (same string) to match **`API_SERVER_KEY`** in `hermes-data/.env`, then restart the chat container. In Docker, Compose sets **`HERMES_URL=http://hermes:8642`**; do not point `HERMES_URL` at `127.0.0.1` from inside the chat container unless you know what you are doing.

**Where to get the value:** open `hermes-data/.env`, find the line `API_SERVER_KEY=...`, copy only the part after `=` into `HERMES_TOKEN=` in **`.env`** (see stack **`.env.example`**). No quotes, no extra spaces.

**Sanity check (no secret printed):** `docker exec hermes-chat sh -c 'test -n "$HERMES_TOKEN" && echo HERMES_TOKEN_set'` and `docker exec hermes-chat printenv HERMES_URL`.

Hermes and HermesChat are **two containers** on the same Docker network (`hermes-net`); they talk over HTTP. They do not need to share a filesystem.
