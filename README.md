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
