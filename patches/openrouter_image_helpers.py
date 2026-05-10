#!/usr/bin/env python3
"""Shared OpenRouter chat/completions helpers for image generation and image+text edits."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

MAX_HTTPS_TOOL_IMAGE_BYTES = 50 * 1024 * 1024

logger = logging.getLogger(__name__)

OPENROUTER_CHAT_URL_DEFAULT = "https://openrouter.ai/api/v1/chat/completions"
CODEX_BASE_URL_DEFAULT = "https://chatgpt.com/backend-api/codex"
DEFAULT_FALLBACK_MODEL = "google/gemini-3.1-flash-image-preview"
CODEX_IMAGE_FALLBACK_MODEL = "gpt-5.5"

ASPECT_TO_OPENROUTER = {
    "landscape": "16:9",
    "square": "1:1",
    "portrait": "9:16",
}

ASPECT_TO_OPENAI_SIZE = {
    "landscape": "1536x1024",
    "square": "1024x1024",
    "portrait": "1024x1536",
}

# Spill image tool outputs to disk so agent history stays small. (Previously we kept data URIs
# inline when under ~96k chars — that still re-sends tens of thousands of tokens on *every*
# subsequent agent step and multiplies OpenRouter cost.)
TOOL_IMAGES_SUBDIR = "tool_images"

_DATA_URI_RE = re.compile(
    r"^data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\s*$",
    re.IGNORECASE | re.DOTALL,
)


def _extension_for_mime(mime: str) -> str:
    m = (mime or "").lower().strip()
    if m in ("image/jpeg", "image/jpg"):
        return ".jpg"
    if m == "image/webp":
        return ".webp"
    if m == "image/gif":
        return ".gif"
    if m in ("image/svg+xml", "image/svg"):
        return ".svg"
    if m in ("image/avif",):
        return ".avif"
    if m in ("image/heic", "image/heif"):
        return ".heic"
    return ".png"


def _sanitize_b64(b64: str) -> str:
    """Strip whitespace and non-base64 noise some APIs append after the payload."""
    t = re.sub(r"\s+", "", (b64 or "").strip())
    return re.sub(r"[^A-Za-z0-9+/=]", "", t)


def _persist_tool_image_raw(raw: bytes, ext: str) -> Optional[str]:
    """Write raw image bytes under ``tool_images/``; ``ext`` must include a leading dot."""
    if not raw:
        return None
    e = ext if ext.startswith(".") else f".{ext}"
    root = (os.getenv("HERMES_HOME") or "/opt/data").strip()
    out_dir = Path(root) / TOOL_IMAGES_SUBDIR
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error(
            "normalize_tool_image: mkdir failed %s: %s (cannot spill)",
            out_dir,
            exc,
        )
        return None
    fname = f"{uuid.uuid4().hex}{e}"
    out_path = out_dir / fname
    try:
        out_path.write_bytes(raw)
    except OSError as exc:
        logger.error(
            "normalize_tool_image: write failed %s: %s (cannot spill %s bytes)",
            out_path,
            exc,
            len(raw),
        )
        return None
    rel = f"{TOOL_IMAGES_SUBDIR}/{fname}"
    try:
        if not out_path.is_file() or out_path.stat().st_size == 0:
            logger.error("normalize_tool_image: wrote empty or missing file %s", out_path)
            return None
    except OSError:
        pass
    logger.info("normalize_tool_image: spilled %s bytes to %s", len(raw), rel)
    return rel


def _extension_from_url_path(url: str) -> Optional[str]:
    try:
        suf = Path(urlparse(url).path).suffix.lower()
        if suf in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".heic", ".heif"):
            return ".jpg" if suf in (".jpeg", ".jpe") else suf
    except Exception:
        pass
    return None


def _extension_from_magic(buf: bytes) -> str:
    if len(buf) >= 3 and buf[0:3] == b"\xff\xd8\xff":
        return ".jpg"
    if len(buf) >= 8 and buf[0:4] == b"\x89PNG":
        return ".png"
    if len(buf) >= 6 and buf[0:3] == b"GIF":
        return ".gif"
    if len(buf) >= 12 and buf[0:4] == b"RIFF" and buf[8:12] == b"WEBP":
        return ".webp"
    if len(buf) >= 12 and buf[4:8] == b"ftyp":
        return ".heic"
    return ".png"


def _spill_https_tool_image_url(url: str) -> Optional[str]:
    """
    GPT / OpenAI image models often return temporary ``https://`` URLs. HermesChat fetch from
    Node may 403 (bot filtering). Download in the gateway (browser-like UA + referer) and
    spill to ``tool_images/`` like data URIs.
    """
    u = (url or "").strip()
    if not u.lower().startswith("https://"):
        return None
    try:
        parsed = urlparse(u)
        host = (parsed.hostname or "").lower()
        if not host or host in ("localhost", "127.0.0.1", "::1"):
            return None
    except Exception:
        return None

    headers: Dict[str, str] = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://openrouter.ai/",
    }
    if host.endswith("openrouter.ai"):
        key = _openrouter_api_key()
        if key:
            headers["Authorization"] = f"Bearer {key}"

    req = urllib.request.Request(u, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            ct = (resp.headers.get("Content-Type") or "").strip()
            cl = resp.headers.get("Content-Length")
            if cl:
                try:
                    if int(cl) > MAX_HTTPS_TOOL_IMAGE_BYTES:
                        logger.warning(
                            "normalize_tool_image: https image too large (Content-Length=%s)",
                            cl,
                        )
                        return None
                except ValueError:
                    pass
            chunks: List[bytes] = []
            total = 0
            while True:
                block = resp.read(65536)
                if not block:
                    break
                total += len(block)
                if total > MAX_HTTPS_TOOL_IMAGE_BYTES:
                    logger.warning(
                        "normalize_tool_image: https download exceeded cap host=%s",
                        host[:80],
                    )
                    return None
                chunks.append(block)
            raw = b"".join(chunks)
    except urllib.error.HTTPError as e:
        detail = b""
        try:
            detail = e.read()[:400]
        except Exception:
            pass
        logger.warning(
            "normalize_tool_image: https fetch HTTP %s for %s detail=%r",
            e.code,
            u[:160],
            detail[:200],
        )
        return None
    except Exception as exc:
        logger.warning(
            "normalize_tool_image: https fetch failed for %s: %s",
            u[:160],
            exc,
        )
        return None

    if not raw:
        logger.warning("normalize_tool_image: empty body from https %s", u[:120])
        return None

    ext = _extension_from_url_path(u)
    if not ext:
        mime_main = ct.split(";")[0].strip().lower() if ct else ""
        if mime_main.startswith("image/"):
            ext = _extension_for_mime(mime_main)
        else:
            ext = _extension_from_magic(raw)
    return _persist_tool_image_raw(raw, ext)


def normalize_tool_image_for_session(image_result: str) -> str:
    """
    Value for JSON ``image`` on ``image_generate`` / ``image_edit``.

    OpenRouter may return ``data:image/...;base64,...``. **Always** persist matching payloads
    under ``$HERMES_HOME/tool_images/`` and return ``tool_images/<file>`` so the tool message
    stays a short path. Inline base64 in history makes every later agent step pay input tokens
    for the full image again and again (runaway spend on “simple” diagnostics).

    Temporary ``https://`` URLs (common for GPT image models) are **downloaded in the gateway**
    and spilled the same way so HermesChat does not depend on fetching provider CDNs.

    Existing ``tool_images/...`` paths are returned unchanged.
    """
    s = (image_result or "").strip()
    if not s:
        return s
    low = s.lower()
    if low.startswith("https://"):
        spilled = _spill_https_tool_image_url(s)
        return spilled if spilled else s
    if not low.startswith("data:image/"):
        return s

    mime: str
    b64: str
    m = _DATA_URI_RE.match(s)
    if m:
        mime = m.group(1).split(";")[0].strip()
        b64 = _sanitize_b64(m.group(2))
    else:
        # Providers sometimes add parameters (e.g. charset) or trailing junk so strict ^…$ fails.
        j = low.find(";base64,")
        if j < 0:
            logger.warning(
                "normalize_tool_image: data URI shape unexpected (len=%s)", len(s)
            )
            return s
        meta = s[5:j]
        if not meta.lower().startswith("image/"):
            logger.warning(
                "normalize_tool_image: not an image/* data URI (len=%s)", len(s)
            )
            return s
        mime = meta.split(";")[0].strip()
        b64 = _sanitize_b64(s[j + 8 :])
    if not b64:
        logger.warning("normalize_tool_image: empty base64 after sanitize (len=%s)", len(s))
        return s
    try:
        # validate= requires Python 3.11+; gateway image is newer, some hosts are not.
        try:
            raw = base64.standard_b64decode(b64, validate=False)
        except TypeError:
            raw = base64.standard_b64decode(b64)
    except Exception as exc:
        logger.warning("normalize_tool_image: base64 decode failed: %s", exc)
        return s
    if not raw:
        logger.warning("normalize_tool_image: empty decoded payload")
        return s
    rel = _persist_tool_image_raw(raw, _extension_for_mime(mime))
    return rel if rel else s


def _read_openrouter_key_from_hermes_dotenv() -> str:
    """When Docker/compose left OPENROUTER_API_KEY unset, read it from HERMES_HOME/.env."""
    home = (os.getenv("HERMES_HOME") or "/opt/data").strip()
    path = os.path.join(home, ".env")
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                if s.startswith("OPENROUTER_API_KEY="):
                    val = s.split("=", 1)[1].strip().strip('"').strip("'")
                    return val
    except OSError:
        pass
    return ""


def _openrouter_api_key() -> str:
    k = (os.getenv("OPENROUTER_API_KEY") or "").strip()
    if k:
        return k
    return _read_openrouter_key_from_hermes_dotenv().strip()


def _openrouter_base_url() -> str:
    raw = (os.getenv("OPENROUTER_BASE_URL") or "").strip().rstrip("/")
    if raw:
        return f"{raw}/chat/completions"
    try:
        from hermes_cli.config import load_config

        cfg = load_config()
        m = cfg.get("model") if isinstance(cfg, dict) else None
        if isinstance(m, dict):
            bu = str(m.get("base_url") or "").strip().rstrip("/")
            if bu:
                return f"{bu}/chat/completions"
    except Exception as exc:
        logger.debug("openrouter base_url from config: %s", exc)
    return OPENROUTER_CHAT_URL_DEFAULT


def load_image_gen_model_from_config() -> str:
    """Return image_gen.model from config.yaml, or empty string."""
    return load_image_gen_config_from_config().get("model", "")


def load_image_gen_config_from_config() -> Dict[str, str]:
    """Return image_gen provider/model/base_url from config.yaml."""
    out = {"model": "", "provider": "openrouter", "base_url": ""}
    try:
        from hermes_cli.config import load_config

        cfg = load_config()
        img_cfg = cfg.get("image_gen") if isinstance(cfg, dict) else None
        if isinstance(img_cfg, dict):
            raw = img_cfg.get("model")
            if isinstance(raw, str) and raw.strip():
                out["model"] = raw.strip()
            provider = img_cfg.get("provider")
            if isinstance(provider, str) and provider.strip():
                out["provider"] = provider.strip()
            base_url = img_cfg.get("base_url")
            if isinstance(base_url, str) and base_url.strip():
                out["base_url"] = base_url.strip().rstrip("/")
    except Exception as exc:
        logger.debug("Could not load image_gen config: %s", exc)
    return out


def aspect_ratio_to_openrouter(aspect_ratio: str, default_key: str = "landscape") -> str:
    ar = (aspect_ratio or default_key).lower().strip()
    return ASPECT_TO_OPENROUTER.get(ar, ASPECT_TO_OPENROUTER["landscape"])


def aspect_ratio_to_openai_size(aspect_ratio: str, default_key: str = "landscape") -> str:
    ar = (aspect_ratio or default_key).lower().strip()
    return ASPECT_TO_OPENAI_SIZE.get(ar, ASPECT_TO_OPENAI_SIZE["landscape"])


def check_openrouter_image_backend_ready() -> bool:
    """True when OPENROUTER_API_KEY is set (model may fall back to DEFAULT_FALLBACK_MODEL)."""
    return bool(_openrouter_api_key())


def check_plan_image_backend_ready() -> bool:
    """True when the configured image_gen provider has usable credentials."""
    cfg = load_image_gen_config_from_config()
    provider = (cfg.get("provider") or "openrouter").strip().lower()
    if provider in ("openai-codex", "codex", "chatgpt"):
        try:
            runtime = _resolve_codex_image_runtime(cfg.get("base_url") or "")
            return bool(runtime.get("api_key"))
        except Exception as exc:
            logger.debug("Codex image backend not ready: %s", exc)
            return False
    return check_openrouter_image_backend_ready()


def _url_from_image_url_field(iu: Any) -> Optional[str]:
    """Normalize image_url / imageUrl (dict or string) to a URL or data URI."""
    if isinstance(iu, str) and iu.strip():
        return iu.strip()
    if isinstance(iu, dict):
        u = iu.get("url") or iu.get("URL")
        if isinstance(u, str) and u.strip():
            return u.strip()
    return None


def _data_uri_from_b64(mime: str, b64_raw: str) -> Optional[str]:
    b64 = _sanitize_b64(b64_raw)
    if not b64:
        return None
    m = (mime or "image/png").strip()
    if not isinstance(m, str) or "/" not in m:
        m = "image/png"
    return f"data:{m};base64,{b64}"


def _urls_from_inline_data_dict(blob: Any) -> List[str]:
    """Gemini / Google-style ``inline_data`` / ``inlineData`` with mime + data."""
    if not isinstance(blob, dict):
        return []
    out: List[str] = []
    mt = (
        blob.get("mime_type")
        or blob.get("mimeType")
        or blob.get("media_type")
        or blob.get("mediaType")
        or "image/png"
    )
    data = blob.get("data")
    if isinstance(data, str) and data.strip():
        u = _data_uri_from_b64(str(mt), data)
        if u:
            out.append(u)
    return out


def _urls_from_source_dict(src: Any) -> List[str]:
    """Anthropic-style ``source``: { type: base64|url, media_type, data }."""
    if not isinstance(src, dict):
        return []
    st = (src.get("type") or "").lower()
    if st == "base64":
        data = src.get("data")
        if not isinstance(data, str) or not data.strip():
            return []
        mt = (
            src.get("media_type")
            or src.get("mime_type")
            or src.get("mimeType")
            or "image/png"
        )
        u = _data_uri_from_b64(str(mt), data)
        return [u] if u else []
    if st == "url":
        u = src.get("url")
        if isinstance(u, str) and u.strip():
            return [u.strip()]
    return []


def _urls_from_any_imageish_part(part: Dict[str, Any]) -> List[str]:
    """Collect image refs from one multimodal content part (any provider shape)."""
    out: List[str] = []
    u = _url_from_image_url_field(part.get("image_url") or part.get("imageUrl"))
    if u:
        out.append(u)
    tu = part.get("url")
    if isinstance(tu, str) and tu.strip():
        out.append(tu.strip())

    for key in ("inline_data", "inlineData"):
        ib = part.get(key)
        if ib is not None:
            out.extend(_urls_from_inline_data_dict(ib))

    out.extend(_urls_from_source_dict(part.get("source")))

    b64 = part.get("b64_json") or part.get("base64")
    if isinstance(b64, str) and b64.strip():
        mt = part.get("mime_type") or part.get("media_type") or "image/png"
        mts = mt.strip() if isinstance(mt, str) and "/" in mt else "image/png"
        u2 = _data_uri_from_b64(mts, b64)
        if u2:
            out.append(u2)

    return out


def _extract_image_urls_from_content_parts(content: Any) -> List[str]:
    """OpenAI-style assistant message: content is a list of {type, image_url|text|...}."""
    if not isinstance(content, list):
        return []
    out: List[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        ptype = (part.get("type") or "").lower()
        if ptype in (
            "image_url",
            "image",
            "output_image",
            "image_generation",
            "inline_data",
            "input_image",
        ):
            for u in _urls_from_any_imageish_part(part):
                if u not in out:
                    out.append(u)
            continue
        if ptype == "text":
            continue
        # Unknown part types: still pick up nested image payloads (provider quirks).
        extra = _urls_from_any_imageish_part(part)
        if extra:
            for u in extra:
                if u not in out:
                    out.append(u)
    return out


_DATA_IMAGE_RE = re.compile(
    r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+",
    re.IGNORECASE,
)

# Skip huge subtrees when deep-scanning provider JSON
_DEEP_SKIP_KEYS = frozenset(
    {
        "usage",
        "prompt_tokens_details",
        "completion_tokens_details",
        "logprobs",
    }
)


def _deep_collect_image_refs(
    obj: Any,
    out: List[str],
    depth: int = 0,
    seen: Optional[set] = None,
) -> None:
    """Last-resort walk for provider-specific shapes (e.g. b64_json, nested output blocks)."""
    if seen is None:
        seen = set()
    if depth > 10 or len(out) > 32:
        return
    if isinstance(obj, str):
        s = obj.strip()
        if s.startswith("data:image/") and "base64," in s and len(s) < 12_000_000:
            out.append(s)
        return
    if isinstance(obj, dict):
        i = id(obj)
        if i in seen:
            return
        seen.add(i)
        b64 = obj.get("b64_json")
        if isinstance(b64, str) and b64.strip():
            mime = obj.get("mime_type") or obj.get("media_type") or "image/png"
            mt = mime.strip() if isinstance(mime, str) and "/" in mime else "image/png"
            out.append(f"data:{mt};base64,{b64.strip()}")
        for k, v in obj.items():
            if k in _DEEP_SKIP_KEYS:
                continue
            _deep_collect_image_refs(v, out, depth + 1, seen)
        return
    if isinstance(obj, list):
        for v in obj:
            _deep_collect_image_refs(v, out, depth + 1, seen)


def _extract_image_urls_from_content_string(text: str) -> List[str]:
    """Some providers embed a single data URI or markdown image in message.content string."""
    if not text or not isinstance(text, str):
        return []
    out: List[str] = []
    for m in _DATA_IMAGE_RE.finditer(text):
        raw = m.group(0).replace("\n", "").replace("\r", "").replace(" ", "")
        if raw:
            out.append(raw)
    for m in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", text):
        href = (m.group(1) or "").strip().strip('"').strip("'")
        if href.startswith("data:image/") or href.startswith("https://"):
            out.append(href)
    return out


def _extract_image_urls_from_message(message: Optional[Dict[str, Any]]) -> List[str]:
    if not message or not isinstance(message, dict):
        return []
    seen: set[str] = set()
    out: List[str] = []

    def add(u: str) -> None:
        s = u.strip()
        if s and s not in seen:
            seen.add(s)
            out.append(s)

    for img in message.get("images") or []:
        if isinstance(img, str) and img.strip():
            add(img)
            continue
        if not isinstance(img, dict):
            continue
        for u in _urls_from_any_imageish_part(img):
            add(u)

    for u in _extract_image_urls_from_content_parts(message.get("content")):
        add(u)

    c = message.get("content")
    if isinstance(c, str):
        for u in _extract_image_urls_from_content_string(c):
            add(u)

    top = message.get("image")
    if isinstance(top, str) and top.strip():
        add(top)
    elif isinstance(top, dict):
        for u in _urls_from_any_imageish_part(top):
            add(u)

    deep_scratch: List[str] = []
    _deep_collect_image_refs(message, deep_scratch)
    for u in deep_scratch:
        add(u)

    return out


def _post_chat_completions(payload: Dict[str, Any]) -> Dict[str, Any]:
    key = _openrouter_api_key()
    if not key:
        raise ValueError("OPENROUTER_API_KEY is not set")

    url = _openrouter_base_url()
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    ref = (os.getenv("HTTP_REFERER") or "http://127.0.0.1").strip()
    title = (os.getenv("X_TITLE") or "Hermes").strip()
    if ref:
        headers["HTTP-Referer"] = ref
    if title:
        headers["X-Title"] = title

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        if e.code == 402:
            raise ValueError(
                "OpenRouter HTTP 402 — add credits at https://openrouter.ai/settings/credits "
                "(image_generate / image_edit bill OpenRouter only; this stack does not use FAL_KEY)."
            ) from e
        raise ValueError(
            f"OpenRouter HTTP {e.code}: {detail[:2000]}"
        ) from e


def openrouter_image_completion(
    *,
    model: str,
    messages: List[Dict[str, Any]],
    image_config: Optional[Dict[str, Any]] = None,
    modalities_prefer: str = "both",
) -> Tuple[str, Dict[str, Any]]:
    """
    Returns (first_image_url_or_data_uri, full_json_response).
    Tries modalities ["image","text"] first, then ["image"] if the API rejects the request.
    modalities_prefer: "both" | "image_only" — which order to try.
    """
    last_err: Optional[Exception] = None
    order: List[List[str]]
    if modalities_prefer == "image_only":
        order = [["image"], ["image", "text"]]
    else:
        order = [["image", "text"], ["image"]]

    for mods in order:
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "modalities": mods,
            "stream": False,
        }
        if image_config:
            payload["image_config"] = image_config
        try:
            data = _post_chat_completions(payload)
        except ValueError as e:
            last_err = e
            logger.info("OpenRouter image attempt modalities=%s failed: %s", mods, e)
            continue

        try:
            from tools.openrouter_sidecar_accounting import record_openrouter_completion_usage

            record_openrouter_completion_usage(model, data)
        except Exception:
            pass

        choices = data.get("choices")
        if not choices:
            last_err = ValueError(f"OpenRouter response has no choices: {json.dumps(data)[:800]}")
            continue
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        urls = _extract_image_urls_from_message(msg if isinstance(msg, dict) else None)
        if not urls and isinstance(choices[0], dict):
            fb: List[str] = []
            _deep_collect_image_refs(choices[0], fb)
            if fb:
                urls = list(dict.fromkeys(fb))
        if urls:
            return urls[0], data
        if isinstance(msg, dict):
            try:
                raw_dbg = json.dumps(msg, ensure_ascii=False)[:3500]
            except Exception:
                raw_dbg = str(msg)[:3500]
            logger.warning(
                "OpenRouter image: could not extract image URL from assistant message "
                "(keys=%s content_type=%s). Raw (truncated): %s",
                list(msg.keys()),
                type(msg.get("content")).__name__,
                raw_dbg,
            )
        last_err = ValueError(
            "Model returned no usable image (checked message.images, multimodal "
            "content parts, and data URLs in message.content). Use a model with "
            "image output_modalities, or inspect gateway logs for the raw message shape."
        )

    if last_err:
        raise last_err
    raise ValueError("OpenRouter image generation failed with no error detail")


def _get_any(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _main_model_from_config() -> str:
    try:
        from hermes_cli.config import load_config

        cfg = load_config()
        model_cfg = cfg.get("model") if isinstance(cfg, dict) else None
        if isinstance(model_cfg, dict):
            model = str(model_cfg.get("default") or "").strip()
            if model:
                return model
        if isinstance(model_cfg, str) and model_cfg.strip():
            return model_cfg.strip()
    except Exception:
        pass
    return CODEX_IMAGE_FALLBACK_MODEL


def _codex_image_model(model: str) -> str:
    mid = (model or "").strip()
    # Responses image_generation uses a text-capable mainline model. GPT Image
    # model ids are selected inside the hosted tool and are not valid here.
    if not mid or "/" in mid or mid.lower().startswith("gpt-image"):
        return _main_model_from_config()
    return mid


def _resolve_codex_image_runtime(base_url: str = "") -> Dict[str, Any]:
    from hermes_cli.runtime_provider import resolve_runtime_provider

    kwargs: Dict[str, Any] = {"requested": "openai-codex"}
    bu = base_url.strip().rstrip("/")
    if bu and bu != CODEX_BASE_URL_DEFAULT:
        kwargs["explicit_base_url"] = bu
    return resolve_runtime_provider(**kwargs)


def _codex_openai_client(runtime: Dict[str, Any]):
    from openai import OpenAI

    token = str(runtime.get("api_key") or "").strip()
    if not token:
        raise ValueError("Codex OAuth token is not available. Run `hermes auth add openai-codex`.")
    base_url = str(runtime.get("base_url") or CODEX_BASE_URL_DEFAULT).strip().rstrip("/")
    headers: Dict[str, str] = {}
    try:
        from agent.auxiliary_client import _codex_cloudflare_headers

        headers = _codex_cloudflare_headers(token)
    except Exception as exc:
        logger.debug("Could not build Codex Cloudflare headers: %s", exc)
    if headers:
        return OpenAI(api_key=token, base_url=base_url, default_headers=headers)
    return OpenAI(api_key=token, base_url=base_url)


def _chat_messages_to_responses_input(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "user").strip() or "user"
        if role == "system":
            role = "user"
        content = msg.get("content", "")
        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue
        parts: List[Dict[str, Any]] = []
        if isinstance(content, list):
            for part in content:
                if isinstance(part, str):
                    if part:
                        parts.append({"type": "input_text", "text": part})
                    continue
                if not isinstance(part, dict):
                    continue
                ptype = str(part.get("type") or "").strip().lower()
                if ptype in ("text", "input_text", "output_text"):
                    text = part.get("text", "")
                    if not isinstance(text, str):
                        text = str(text or "")
                    if text:
                        parts.append({"type": "input_text", "text": text})
                    continue
                if ptype in ("image_url", "input_image", "image"):
                    iu = part.get("image_url") or part.get("imageUrl") or part.get("url")
                    url = _url_from_image_url_field(iu)
                    if url:
                        parts.append({"type": "input_image", "image_url": url})
        if parts:
            out.append({"role": role, "content": parts})
    return out or [{"role": "user", "content": ""}]


def _extract_responses_image_refs(response: Any) -> List[str]:
    refs: List[str] = []

    def add_ref(value: Any) -> None:
        if not isinstance(value, str):
            return
        s = value.strip()
        if not s:
            return
        if s.startswith("data:image/") or s.startswith("https://"):
            refs.append(s)
        elif len(s) > 128:
            refs.append(f"data:image/png;base64,{_sanitize_b64(s)}")

    def walk(obj: Any, depth: int = 0) -> None:
        if depth > 8 or len(refs) > 16:
            return
        typ = str(_get_any(obj, "type", "") or "")
        if typ == "image_generation_call":
            add_ref(_get_any(obj, "result"))
        if isinstance(obj, dict):
            for v in obj.values():
                walk(v, depth + 1)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, depth + 1)
        else:
            if hasattr(obj, "model_dump"):
                try:
                    walk(obj.model_dump(), depth + 1)
                except Exception:
                    pass
            elif hasattr(obj, "__dict__"):
                walk(vars(obj), depth + 1)

    walk(getattr(response, "output", None) or (response.get("output") if isinstance(response, dict) else None))
    if not refs:
        scratch: List[str] = []
        _deep_collect_image_refs(
            response.model_dump() if hasattr(response, "model_dump") else response,
            scratch,
        )
        refs.extend(scratch)
    return list(dict.fromkeys(refs))


def _response_to_raw_dict(response: Any) -> Dict[str, Any]:
    if isinstance(response, dict):
        return response
    if hasattr(response, "model_dump"):
        try:
            return response.model_dump()
        except Exception:
            pass
    return {"response": repr(response)}


def _create_codex_streaming_response(client: Any, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Codex backend requires streaming; collect events into a response-like dict."""
    stream_payload = dict(payload)
    stream_payload["stream"] = True
    events: List[Any] = []
    stream = client.responses.create(**stream_payload)
    try:
        for event in stream:
            events.append(_response_to_raw_dict(event))
    finally:
        close = getattr(stream, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass
    return {"output": events}


def codex_responses_image_completion(
    *,
    model: str,
    messages: List[Dict[str, Any]],
    base_url: str = "",
    aspect_ratio: str = "landscape",
    action: str = "auto",
) -> Tuple[str, Dict[str, Any]]:
    runtime = _resolve_codex_image_runtime(base_url)
    client = _codex_openai_client(runtime)
    model_id = _codex_image_model(model)
    size = aspect_ratio_to_openai_size(aspect_ratio)
    instructions = (
        "Use the image_generation tool to create the requested image. "
        "Return the generated image result directly; do not use OpenRouter or any external image backend."
    )
    tool: Dict[str, Any] = {
        "type": "image_generation",
        "size": size,
        "quality": "auto",
        "action": action if action in ("auto", "generate", "edit") else "auto",
    }
    payload: Dict[str, Any] = {
        "model": model_id,
        "instructions": instructions,
        "input": _chat_messages_to_responses_input(messages),
        "tools": [tool],
        "tool_choice": {"type": "image_generation"},
        "store": False,
    }
    try:
        response = _create_codex_streaming_response(client, payload)
    except Exception as first_exc:
        logger.info("Codex image_generation full tool payload failed; retrying bare tool: %s", first_exc)
        payload["tools"] = [{"type": "image_generation"}]
        response = _create_codex_streaming_response(client, payload)
    refs = _extract_responses_image_refs(response)
    if not refs:
        raise ValueError("Codex image_generation returned no image result")
    return refs[0], _response_to_raw_dict(response)


def plan_image_completion(
    *,
    model: str,
    messages: List[Dict[str, Any]],
    image_config: Optional[Dict[str, Any]] = None,
    modalities_prefer: str = "both",
    provider: str = "",
    base_url: str = "",
    aspect_ratio: str = "landscape",
    action: str = "auto",
) -> Tuple[str, Dict[str, Any]]:
    provider_lc = (provider or "openrouter").strip().lower()
    if provider_lc in ("openai-codex", "codex", "chatgpt"):
        return codex_responses_image_completion(
            model=model,
            messages=messages,
            base_url=base_url,
            aspect_ratio=aspect_ratio,
            action=action,
        )
    if provider_lc in ("", "openrouter"):
        return openrouter_image_completion(
            model=model,
            messages=messages,
            image_config=image_config,
            modalities_prefer=modalities_prefer,
        )
    raise ValueError(f"Unsupported image_gen.provider: {provider}")
