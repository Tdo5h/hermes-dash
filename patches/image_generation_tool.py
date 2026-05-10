#!/usr/bin/env python3
"""
Image generation via the active plan's configured image backend.

OpenRouter plans use OpenRouter chat/completions with image output modalities.
The ChatGPT/Codex plan uses the connected Codex OAuth account and the Responses
``image_generation`` tool, so it does not require OpenRouter credit.
"""

from __future__ import annotations

import datetime
import json
import logging
from typing import Any, Dict, Optional

from tools.openrouter_image_helpers import (
    DEFAULT_FALLBACK_MODEL,
    aspect_ratio_to_openrouter,
    check_plan_image_backend_ready,
    load_image_gen_config_from_config,
    normalize_tool_image_for_session,
    plan_image_completion,
)

logger = logging.getLogger(__name__)

DEFAULT_ASPECT_RATIO = "landscape"
VALID_ASPECT_RATIOS = ("landscape", "square", "portrait")


def _resolve_image_config() -> Dict[str, str]:
    cfg = load_image_gen_config_from_config()
    mid = cfg.get("model", "").strip()
    if mid:
        return cfg
    logger.warning(
        "image_gen.model missing in config; using fallback %s", DEFAULT_FALLBACK_MODEL
    )
    cfg["model"] = DEFAULT_FALLBACK_MODEL
    return cfg


def image_generate_tool(
    prompt: str,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    num_inference_steps: Optional[int] = None,
    guidance_scale: Optional[float] = None,
    num_images: Optional[int] = None,
    output_format: Optional[str] = None,
    seed: Optional[int] = None,
) -> str:
    """Generate an image from a text prompt via the active plan."""
    image_cfg = _resolve_image_config()
    model_id = image_cfg.get("model", "")
    provider = (image_cfg.get("provider") or "openrouter").strip() or "openrouter"
    base_url = image_cfg.get("base_url", "")
    debug_call_data: Dict[str, Any] = {
        "model": model_id,
        "provider": provider,
        "parameters": {
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
        },
        "error": None,
        "success": False,
        "images_generated": 0,
        "generation_time": 0,
    }
    start_time = datetime.datetime.now()

    try:
        if not prompt or not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("Prompt is required and must be a non-empty string")
        if not check_plan_image_backend_ready():
            raise ValueError(
                f"Image backend for provider '{provider}' is not ready. Check the active plan credentials."
            )

        aspect_lc = (aspect_ratio or DEFAULT_ASPECT_RATIO).lower().strip()
        if aspect_lc not in VALID_ASPECT_RATIOS:
            logger.warning(
                "Invalid aspect_ratio '%s', defaulting to '%s'",
                aspect_ratio,
                DEFAULT_ASPECT_RATIO,
            )
            aspect_lc = DEFAULT_ASPECT_RATIO

        or_aspect = aspect_ratio_to_openrouter(aspect_lc)
        image_config: Dict[str, Any] = {"aspect_ratio": or_aspect}

        messages = [
            {
                "role": "user",
                "content": prompt.strip(),
            }
        ]

        logger.info(
            "image_generate provider=%s model=%s aspect=%s prompt=%s",
            provider,
            model_id,
            or_aspect,
            prompt[:80],
        )

        image_url, _raw = plan_image_completion(
            model=model_id,
            messages=messages,
            image_config=image_config,
            modalities_prefer="both",
            provider=provider,
            base_url=base_url,
            aspect_ratio=aspect_lc,
            action="generate",
        )

        image_url = normalize_tool_image_for_session(image_url)
        generation_time = (datetime.datetime.now() - start_time).total_seconds()
        response_data = {"success": True, "image": image_url}
        debug_call_data["success"] = True
        debug_call_data["images_generated"] = 1
        debug_call_data["generation_time"] = generation_time
        logger.info(
            "Generated image in %.1fs via %s model=%s",
            generation_time,
            provider,
            model_id,
        )
        return json.dumps(response_data, indent=2, ensure_ascii=False)

    except Exception as e:
        generation_time = (datetime.datetime.now() - start_time).total_seconds()
        error_msg = f"Error generating image: {str(e)}"
        logger.error("%s", error_msg, exc_info=True)
        debug_call_data["error"] = error_msg
        debug_call_data["generation_time"] = generation_time
        return json.dumps(
            {
                "success": False,
                "image": None,
                "error": str(e),
                "error_type": type(e).__name__,
            },
            indent=2,
            ensure_ascii=False,
        )


def check_image_generation_requirements() -> bool:
    return check_plan_image_backend_ready()


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
from tools.registry import registry, tool_error

IMAGE_GENERATE_SCHEMA = {
    "name": "image_generate",
    "description": (
        "Generate images from text prompts via the active plan using the configured "
        "`image_gen.model` (not selectable per call). Returns HTTPS URL, a short "
        "data URI, or `tool_images/<file>` under Hermes data. Use **exactly** the "
        "`image` string in markdown ![desc](<that value>) — never invent "
        "`/api/images/latest.png` or other paths. **Do not** use `write_file` to "
        "save a data URL as text for images — use this tool so the chat UI can show the picture."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "The text prompt describing the desired image. Be detailed and descriptive.",
            },
            "aspect_ratio": {
                "type": "string",
                "enum": list(VALID_ASPECT_RATIOS),
                "description": "Aspect ratio: landscape (16:9), portrait (9:16), square (1:1).",
                "default": DEFAULT_ASPECT_RATIO,
            },
        },
        "required": ["prompt"],
    },
}


def _handle_image_generate(args, **kw):
    prompt = args.get("prompt", "")
    if not prompt:
        return tool_error("prompt is required for image generation")
    aspect_ratio = args.get("aspect_ratio", DEFAULT_ASPECT_RATIO)
    return image_generate_tool(prompt=prompt, aspect_ratio=aspect_ratio)


registry.register(
    name="image_generate",
    toolset="image_gen",
    schema=IMAGE_GENERATE_SCHEMA,
    handler=_handle_image_generate,
    check_fn=check_image_generation_requirements,
    requires_env=[],
    is_async=False,
    emoji="🎨",
)
