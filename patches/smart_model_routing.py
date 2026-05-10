"""
Shim for `from agent.smart_model_routing import resolve_turn_route`.

`patches/gateway_run.py` and `patches/cron_scheduler.py` call this, but the pinned
Nous image (e.g. v2026.4.23) may not ship `agent/smart_model_routing.py` yet.
This module is bind-mounted as `/opt/hermes/agent/smart_model_routing.py`.

When `smart_model_routing.enabled` is false, returns the primary model/runtime
unchanged. When enabled, route short/simple prompts to the configured
``cheap_model`` while preserving provider credentials.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)
_warned_enabled_fallback: bool = False


def resolve_turn_route(
    user_message: str,
    smart_config: dict[str, Any] | None,
    primary: dict[str, Any],
) -> dict[str, Any]:
    cfg = smart_config or {}
    enabled = bool(cfg.get("enabled"))

    if not enabled:
        return _primary_route(primary)

    cheap_cfg = cfg.get("cheap_model")
    if isinstance(cheap_cfg, dict) and _is_simple_prompt(user_message, cfg):
        route = _cheap_route(cheap_cfg, primary)
        if route is not None:
            return route
    return _primary_route(primary)


def _is_simple_prompt(user_message: str, cfg: dict[str, Any]) -> bool:
    text = (user_message or "").strip()
    if not text:
        return False
    max_chars = int(cfg.get("max_simple_chars") or 160)
    max_words = int(cfg.get("max_simple_words") or 28)
    words = [w for w in text.split() if w]
    return len(text) <= max_chars and len(words) <= max_words


def _cheap_route(cheap_cfg: dict[str, Any], primary: dict[str, Any]) -> dict[str, Any] | None:
    model = str(cheap_cfg.get("model") or "").strip()
    if not model:
        return None
    provider = str(cheap_cfg.get("provider") or primary.get("provider") or "").strip() or None
    base_url = str(cheap_cfg.get("base_url") or "").strip() or None
    runtime = _runtime_for_provider(provider, base_url, primary)
    return {"model": model, "runtime": runtime}


def _runtime_for_provider(
    provider: str | None,
    base_url: str | None,
    primary: dict[str, Any],
) -> dict[str, Any]:
    if not provider or provider == primary.get("provider"):
        runtime = {k: v for k, v in (primary or {}).items() if k != "model"}
        if base_url:
            runtime["base_url"] = base_url
        return runtime
    try:
        from hermes_cli.runtime_provider import resolve_runtime_provider

        resolved = resolve_runtime_provider(
            requested=provider,
            explicit_base_url=base_url,
        )
        return {
            "api_key": resolved.get("api_key"),
            "base_url": resolved.get("base_url"),
            "provider": resolved.get("provider"),
            "api_mode": resolved.get("api_mode"),
            "command": resolved.get("command"),
            "args": list(resolved.get("args") or []),
            "credential_pool": resolved.get("credential_pool"),
        }
    except Exception as exc:
        global _warned_enabled_fallback
        if not _warned_enabled_fallback:
            _warned_enabled_fallback = True
            logger.warning("smart_model_routing cheap provider resolution failed: %s", exc)
        return {k: v for k, v in (primary or {}).items() if k != "model"}


def _primary_route(primary: dict[str, Any]) -> dict[str, Any]:
    """Return primary as { model, runtime } for gateway and cron; runtime mirrors
    all primary fields except *model* so new kwargs (e.g. from OpenRouter) are preserved."""
    model = primary.get("model")
    runtime: dict[str, Any] = {k: v for k, v in (primary or {}).items() if k != "model"}
    if "args" in runtime and runtime.get("args") is not None:
        runtime = {**runtime, "args": list(runtime["args"])}
    return {"model": model, "runtime": runtime}
