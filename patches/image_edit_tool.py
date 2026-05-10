#!/usr/bin/env python3
"""
Multi-reference image editing via the active plan's configured image backend.

OpenRouter plans use OpenRouter image-capable chat models. The ChatGPT/Codex
plan uses the connected account and the Responses ``image_generation`` tool.
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
from typing import Any, List

from tools.openrouter_image_helpers import (
    DEFAULT_FALLBACK_MODEL,
    aspect_ratio_to_openrouter,
    check_plan_image_backend_ready,
    load_image_gen_config_from_config,
    normalize_tool_image_for_session,
    plan_image_completion,
)

logger = logging.getLogger(__name__)

MAX_REFERENCE_IMAGES = 8
MAX_FILE_BYTES = 20 * 1024 * 1024

DEFAULT_ASPECT_RATIO = "landscape"
VALID_ASPECT_RATIOS = ("landscape", "square", "portrait")

ALLOWED_PATH_PREFIXES = ("/var/hermes-chat", "/opt/data")


def _allowed_local_path(path: str) -> bool:
    ap = os.path.abspath(path)
    for prefix in ALLOWED_PATH_PREFIXES:
        if ap == prefix or ap.startswith(prefix + os.sep):
            return True
    return False


def _file_to_data_uri(path: str) -> str:
    if not _allowed_local_path(path):
        raise ValueError(
            f"Image path must be under Hermes chat or data dirs: {path}"
        )
    if not os.path.isfile(path):
        raise ValueError(f"Not a file: {path}")
    size = os.path.getsize(path)
    if size > MAX_FILE_BYTES:
        raise ValueError(
            f"Image too large for inline edit ({size} bytes max {MAX_FILE_BYTES}): {path}"
        )
    mime, _ = mimetypes.guess_type(path)
    if not mime or not mime.startswith("image/"):
        mime = "image/png"
    with open(path, "rb") as f:
        raw = f.read()
    b64 = base64.standard_b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _resolve_reference(ref: str) -> str:
    s = (ref or "").strip()
    if not s:
        raise ValueError("Empty reference image entry")
    if s.startswith(("http://", "https://")):
        return s
    return _file_to_data_uri(s)


def _resolve_image_config() -> dict[str, str]:
    cfg = load_image_gen_config_from_config()
    mid = cfg.get("model", "").strip()
    if mid:
        return cfg
    logger.warning(
        "image_gen.model missing in config; using fallback %s", DEFAULT_FALLBACK_MODEL
    )
    cfg["model"] = DEFAULT_FALLBACK_MODEL
    return cfg


def check_image_edit_requirements() -> bool:
    return check_plan_image_backend_ready()


def image_edit_tool(
    prompt: str,
    reference_images: List[str],
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
) -> str:
    """Edit or fuse images via the active plan image backend."""
    start_payload = {
        "success": False,
        "image": None,
        "error": None,
        "error_type": None,
    }
    try:
        if not prompt or not str(prompt).strip():
            raise ValueError("prompt is required")
        if not reference_images or not isinstance(reference_images, list):
            raise ValueError("reference_images must be a non-empty list")
        if len(reference_images) > MAX_REFERENCE_IMAGES:
            raise ValueError(
                f"At most {MAX_REFERENCE_IMAGES} reference images (got {len(reference_images)})"
            )
        if not check_plan_image_backend_ready():
            raise ValueError(
                "The configured image backend is not ready. Check the active plan credentials."
            )

        ar = (aspect_ratio or DEFAULT_ASPECT_RATIO).lower().strip()
        if ar not in VALID_ASPECT_RATIOS:
            ar = DEFAULT_ASPECT_RATIO
        or_aspect = aspect_ratio_to_openrouter(ar)

        urls: List[str] = []
        for ref in reference_images:
            urls.append(_resolve_reference(str(ref)))

        image_cfg = _resolve_image_config()
        model_id = image_cfg.get("model", "")
        provider = (image_cfg.get("provider") or "openrouter").strip() or "openrouter"
        base_url = image_cfg.get("base_url", "")
        image_config: dict[str, Any] = {"aspect_ratio": or_aspect}

        content: List[dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    f"{prompt.strip()}\n\n"
                    "Produce an edited or new image based on the attached reference image(s)."
                ),
            }
        ]
        for u in urls:
            content.append({"type": "image_url", "image_url": {"url": u}})

        messages = [{"role": "user", "content": content}]

        logger.info(
            "image_edit provider=%s model=%s aspect=%s refs=%s prompt=%s",
            provider,
            model_id,
            or_aspect,
            len(urls),
            prompt[:80],
        )

        image_url, _raw = plan_image_completion(
            model=model_id,
            messages=messages,
            image_config=image_config,
            modalities_prefer="both",
            provider=provider,
            base_url=base_url,
            aspect_ratio=ar,
            action="edit",
        )

        image_url = normalize_tool_image_for_session(image_url)
        out = {"success": True, "image": image_url}
        return json.dumps(out, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error("image_edit failed: %s", e, exc_info=True)
        start_payload["error"] = str(e)
        start_payload["error_type"] = type(e).__name__
        return json.dumps(start_payload, indent=2, ensure_ascii=False)


IMAGE_EDIT_SCHEMA = {
    "name": "image_edit",
    "description": (
        "Edit, fuse, or recreate from reference images via the active plan using the configured "
        "`image_gen.model` (must support image input and image output). Pass paths from "
        "`[media attached: ...]` and/or https URLs. For text-to-image only, use image_generate."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": (
                    "What to change or create across the references (style, merge, background, etc.). "
                    "You may refer to image order."
                ),
            },
            "reference_images": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": MAX_REFERENCE_IMAGES,
                "description": "1–8 paths from [media attached: ...] or https image URLs.",
            },
            "aspect_ratio": {
                "type": "string",
                "enum": list(VALID_ASPECT_RATIOS),
                "description": "Output aspect ratio (maps to OpenRouter image_config.aspect_ratio).",
                "default": DEFAULT_ASPECT_RATIO,
            },
        },
        "required": ["prompt", "reference_images"],
    },
}


def _handle_image_edit(args, **kw):
    prompt = args.get("prompt", "")
    refs = args.get("reference_images")
    if not refs:
        return tool_error("reference_images is required (1–8 images)")
    return image_edit_tool(
        prompt=prompt,
        reference_images=refs,
        aspect_ratio=args.get("aspect_ratio", DEFAULT_ASPECT_RATIO),
    )


from tools.registry import registry, tool_error

registry.register(
    name="image_edit",
    toolset="image_gen",
    schema=IMAGE_EDIT_SCHEMA,
    handler=_handle_image_edit,
    check_fn=check_image_edit_requirements,
    requires_env=[],
    is_async=False,
    emoji="\U0001f5bc",
)
