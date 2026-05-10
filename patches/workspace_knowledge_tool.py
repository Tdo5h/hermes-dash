#!/usr/bin/env python3
"""Read/write workspace wiki and extracted markdown in HermesChat Postgres (internal HTTP API).

HermesChat injects stored documents into the workspace system prompt. Use these tools when
write_file under projects/<slug>/ fails (permissions) or to mirror vault markdown.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any, Dict
from urllib.parse import quote

from tools.registry import registry, tool_error

logger = logging.getLogger(__name__)

_DEFAULT_CHAT_URL = "http://hermes-chat:3100"


def _workspace_knowledge_targets() -> list[tuple[str, str]]:
    """(base_url, bearer) pairs for HermesChat /api/internal/workspace-knowledge.

    Docker Compose often sets HERMESCHAT_INTERNAL_URL="" explicitly; empty must not
    override the default host. Multi-tenant stacks can set *_USER1 / *_USER2 with each
    tenant's HERMES_TOKEN (same as authorizeHermesGatewayToken on Chat).
    """
    out: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(url: str, token: str) -> None:
        u = url.strip().rstrip("/")
        t = token.strip()
        if not u or not t:
            return
        key = (u, t)
        if key in seen:
            return
        seen.add(key)
        out.append(key)

    for suffix in ("USER1", "USER2"):
        add(
            os.getenv(f"HERMESCHAT_INTERNAL_URL_{suffix}", ""),
            os.getenv(f"HERMESCHAT_INTERNAL_TOKEN_{suffix}", ""),
        )

    primary_url = os.getenv("HERMESCHAT_INTERNAL_URL", "").strip()
    primary_tok = (
        os.getenv("HERMESCHAT_INTERNAL_TOKEN", "").strip()
        or os.getenv("API_SERVER_KEY", "").strip()
    )
    if primary_url:
        add(primary_url, primary_tok)
    elif primary_tok:
        add(_DEFAULT_CHAT_URL, primary_tok)

    if not out:
        fallback = os.getenv("API_SERVER_KEY", "").strip()
        if fallback:
            add(_DEFAULT_CHAT_URL, fallback)

    return out


def _http_json_for(
    method: str,
    path_qs: str,
    body: Dict[str, Any] | None,
    base_url: str,
    token: str,
) -> Dict[str, Any]:
    url = f"{base_url.rstrip('/')}{path_qs}"
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:4000]
        try:
            j = json.loads(err_body)
            msg = j.get("error", err_body)
        except Exception:
            msg = err_body or str(e)
        return tool_error(f"workspace knowledge HTTP {e.code}: {msg}")
    except Exception as e:
        return tool_error(f"workspace knowledge request failed: {e}")


WORKSPACE_KNOWLEDGE_WRITE_SCHEMA = {
    "name": "workspace_knowledge_write",
    "description": (
        "Upsert markdown for a HermesChat workspace into Postgres via HermesChat internal API. "
        "Invoke this as a normal gateway tool (like read_file)—not inside execute_code; "
        "hermes_tools in the sandbox does not include this. "
        "doc_path must be wiki/..., extracted/..., or INDEX.md / LOG.md / SCHEMA.md. "
        "project_slug must be an allowed workspace (active vault or shared slugs from the session prompt). "
        "The server performs a mandatory read-back check after write; the tool fails if verification does not match."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "project_slug": {
                "type": "string",
                "description": "Workspace slug from the session (e.g. epl-shop-items).",
            },
            "doc_path": {
                "type": "string",
                "description": "Relative path under the project: wiki/..., extracted/..., INDEX.md, LOG.md, SCHEMA.md",
            },
            "content": {
                "type": "string",
                "description": "Full markdown body.",
            },
        },
        "required": ["project_slug", "doc_path", "content"],
    },
}


def _handle_write(args: Dict[str, Any], **kw: Any) -> Dict[str, Any]:
    slug = (args.get("project_slug") or "").strip()
    doc_path = (args.get("doc_path") or "").strip()
    content = args.get("content")
    if not slug or not doc_path:
        return tool_error("project_slug and doc_path are required")
    if not isinstance(content, str):
        return tool_error("content must be a string")

    targets = _workspace_knowledge_targets()
    if not targets:
        return tool_error(
            "No HermesChat internal API targets: set HERMESCHAT_INTERNAL_URL + "
            "HERMESCHAT_INTERNAL_TOKEN (or API_SERVER_KEY), or HERMESCHAT_INTERNAL_URL_USER1 "
            "+ HERMESCHAT_INTERNAL_TOKEN_USER1 for multi-tenant architect."
        )

    payload = {
        "projectSlug": slug,
        "docPath": doc_path,
        "content": content,
    }
    qs = f"?projectSlug={quote(slug)}&docPath={quote(doc_path)}"
    ok_hosts: list[str] = []
    errors: list[str] = []

    for base_url, token in targets:
        post = _http_json_for("POST", "/api/internal/workspace-knowledge", payload, base_url, token)
        if post.get("error"):
            errors.append(f"{base_url}: {post.get('error', post)}")
            continue
        verify = _http_json_for("GET", f"/api/internal/workspace-knowledge{qs}", None, base_url, token)
        if verify.get("error"):
            errors.append(f"{base_url} verify: {verify.get('error', verify)}")
            continue
        got = verify.get("content")
        if not isinstance(got, str):
            errors.append(f"{base_url}: verify missing content")
            continue
        if got != content:
            errors.append(f"{base_url}: read-back mismatch")
            continue
        ok_hosts.append(base_url)

    if not ok_hosts:
        return tool_error(
            "workspace_knowledge_write failed on all Chat targets: " + "; ".join(errors[:4])
        )

    return {
        "ok": True,
        "verified": True,
        "verify": "read_back_ok",
        "replicatedTo": ok_hosts,
        **({"partialErrors": errors} if errors else {}),
    }


WORKSPACE_KNOWLEDGE_READ_SCHEMA = {
    "name": "workspace_knowledge_read",
    "description": (
        "Read workspace markdown from HermesChat Postgres. Native gateway tool only—not available "
        "inside execute_code. Omit doc_path to list stored paths and sizes; set doc_path for one file."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "project_slug": {"type": "string", "description": "Workspace slug."},
            "doc_path": {
                "type": "string",
                "description": "Optional. Specific path (wiki/..., extracted/..., INDEX.md, ...).",
            },
        },
        "required": ["project_slug"],
    },
}


def _handle_read(args: Dict[str, Any], **kw: Any) -> Dict[str, Any]:
    slug = (args.get("project_slug") or "").strip()
    if not slug:
        return tool_error("project_slug is required")
    doc_path = (args.get("doc_path") or "").strip()
    if doc_path:
        qs = f"?projectSlug={quote(slug)}&docPath={quote(doc_path)}"
    else:
        qs = f"?projectSlug={quote(slug)}"

    targets = _workspace_knowledge_targets()
    if not targets:
        return tool_error(
            "No HermesChat internal API targets (see workspace_knowledge_write error text)."
        )
    last_err: Dict[str, Any] | None = None
    for base_url, token in targets:
        got = _http_json_for("GET", f"/api/internal/workspace-knowledge{qs}", None, base_url, token)
        if not got.get("error"):
            return got
        last_err = got
    return last_err or tool_error("workspace_knowledge_read failed")


def _check_workspace_knowledge(**kwargs: Any) -> bool:
    return True


registry.register(
    name="workspace_knowledge_write",
    toolset="workspace_knowledge",
    schema=WORKSPACE_KNOWLEDGE_WRITE_SCHEMA,
    handler=_handle_write,
    check_fn=_check_workspace_knowledge,
    requires_env=[],
    is_async=False,
    emoji="📚",
)

registry.register(
    name="workspace_knowledge_read",
    toolset="workspace_knowledge",
    schema=WORKSPACE_KNOWLEDGE_READ_SCHEMA,
    handler=_handle_read,
    check_fn=_check_workspace_knowledge,
    requires_env=[],
    is_async=False,
    emoji="📚",
)
