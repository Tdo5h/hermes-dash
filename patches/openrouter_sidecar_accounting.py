"""Accumulate OpenRouter usage from sidecar HTTP clients (e.g. image_generate / image_edit).

Main agent completions go through ``run_agent`` and update session token/cost counters.
Image tools call OpenRouter via ``urllib`` and must record usage here so ``api_server`` can
merge tokens + native ``cost`` into the final chat completion ``usage`` object.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

_lock = threading.Lock()
_events: List[Dict[str, Any]] = []


def record_openrouter_completion_usage(model: str, data: Optional[Dict[str, Any]]) -> None:
    """Append one non-streaming chat/completions JSON body (must include ``usage`` when present)."""
    if not data or not isinstance(data, dict):
        return
    u = data.get("usage")
    if not isinstance(u, dict):
        return
    ev = {
        "model": (model or "").strip(),
        "usage": dict(u),
    }
    with _lock:
        _events.append(ev)


def take_sidecar_usage_events() -> List[Dict[str, Any]]:
    """Return and clear all recorded events (call once per agent run, same thread pool as tools)."""
    with _lock:
        out = list(_events)
        _events.clear()
        return out
