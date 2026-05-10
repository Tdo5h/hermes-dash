---
name: shared-wiki-vault-io
description: >-
  Where shared (VPN-wide) workspace files live on the Hermes gateway and how to read/write them.
  Use when ingesting uploads, maintaining wiki/extracted/INDEX, or debugging missing vault files.
---

# Shared wiki filesystem on the gateway

## Two trees (do not confuse them)

- **`/vault-shared/<workspace-slug>/`** — HermesChat + bridge store **shared** workspace uploads and vault markdown here. This is the source of truth for shared wikis.
- **`/opt/data/projects/<slug>/`** — Tenant-**private** vault on gateways that also mount a private `projects` tree. **Not** where shared workspace bytes live.

Relative tool paths like `projects/<slug>/wiki/...` resolve under **`/opt/hermes/projects/`** (cwd `/opt/hermes`). In stacks that bind-mount the shared-wiki host tree at **`/opt/hermes/projects`**, those relative paths align with slug directories on disk.

## What to use

- For **read_file**, **write_file**, **search_files** on a **shared** workspace: prefer **absolute** paths **`/vault-shared/<slug>/…`** (e.g. `…/sources/`, `…/extracted/`, `…/wiki/`).
- **execute_code** and **terminal** run in a sandbox whose cwd is `/opt/hermes`; they do **not** see uploads unless the same files exist under paths you pass explicitly (e.g. `/vault-shared/...`). Prefer gateway tools for vault I/O.

## Architect gateway vs routing

Where upload bytes land (**`/vault-shared/<slug>/`**) does **not** depend on whether the user’s session talks to tenant Hermes or the **architect** Hermes gateway. This skill only documents **disk paths**.
