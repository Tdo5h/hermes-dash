# HermesChat

A mobile-first PWA that talks to **[Hermes](https://hermes-agent.nousresearch.com/)** (OpenAI-compatible API). Models, tools, and provider keys are configured on the **Hermes** side (`hermes-data/.env`, `config.yaml`); this repo is the UI, session storage, and optional web push.

## Quick start (Hermes stack)

1. Run **Hermes** (Docker or native) with **`API_SERVER_KEY`** set in `hermes-data/.env`.
2. Copy **`.env.example`** → **`.env.local`** (or copy the stack root **`.env`** from `hermes-stack/`) and set **`HERMES_TOKEN`** to the **same value** as **`API_SERVER_KEY`**.
3. **`npm install`** && **`npm run dev`** — app listens on **http://localhost:3100**.

Full steps: **[SETUP.md](./SETUP.md)**. New machine / duplicate VPS: **[GREENFIELD.md](../GREENFIELD.md)** and stack **`.env.example`**.


## Development

For the full stack, use the dev Compose overlay from the stack root. It keeps
production on `3100` and runs hot-reload Next.js on the first free port from
`3101-3105`.

```bash
cd /root/hermes-stack
./scripts/chat-dev-up.sh
./scripts/chat-dev-logs.sh
```

From another computer, keep the dev server private with an SSH tunnel:

```bash
ssh -N -L 3102:127.0.0.1:3102 <user>@<vps-host>
```

Then open `http://127.0.0.1:3102/chat` on that computer. If the dev helper
picked a different port, use that port in both places. Avoid exposing Next dev
directly to the public internet unless it is behind a firewall, VPN, or
Cloudflare Access.

When the UI is ready to ship:

```bash
./scripts/chat-prod-deploy.sh
```

Standalone local dev still works if you mirror the stack env into this folder:

```bash
npm install
npm run dev
```

## Defaults

- **`CHAT_MODEL`** defaults to `hermes-agent` if unset; Hermes may still route to the configured LLM.
- Optional session overrides in Settings (e.g. wiki ingest model) send catalog ids your Hermes gateway can route (typically [Nous models](https://portal.nousresearch.com/models)).
