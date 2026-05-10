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
