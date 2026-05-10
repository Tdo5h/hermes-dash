import { createReadStream } from "fs";
import { readFile, stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { findBuildListAppById } from "@/lib/builds-manifest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function contentTypeFor(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".tsv")) return "text/tab-separated-values; charset=utf-8";
  if (lower.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "application/yaml; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}

function safeRelativePath(parts: string[]): string | null {
  const joined = parts.join("/").replace(/\\/g, "/");
  if (!joined || joined.startsWith("/") || joined.includes("\0")) return null;
  const normalized = path.posix.normalize(joined);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseRange(range: string | null, size: number): { start: number; end: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : NaN;
  let end = match[2] ? Number(match[2]) : NaN;
  if (!Number.isFinite(start) && Number.isFinite(end)) {
    start = Math.max(size - end, 0);
    end = size - 1;
  } else if (Number.isFinite(start) && !Number.isFinite(end)) {
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function injectMobileBuildFit(html: string, buildId: string): string {
  const baseHref = `/api/builds/static/${encodeURIComponent(buildId)}/`;
  const preflight = `
<base href="${baseHref}">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover, user-scalable=yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script id="hermes-build-fit-preflight">
(function(){
  try {
    function progress(stage) {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ source: 'hermes-build-viewer', buildId: ${JSON.stringify(buildId)}, stage: stage }, window.location.origin);
        }
      } catch (e) {}
    }
    progress('start');
    document.addEventListener('DOMContentLoaded', function(){ progress('dom'); }, { once: true });
    window.addEventListener('load', function(){ progress('load'); }, { once: true });
    var d = document;
    var h = d.head || d.documentElement;
    function meta(name, content) {
      var el = d.querySelector('meta[name="' + name + '"]');
      if (!el) {
        el = d.createElement('meta');
        el.name = name;
        h.appendChild(el);
      }
      el.content = content;
    }
    meta('viewport', 'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover, user-scalable=yes');
    meta('apple-mobile-web-app-capable', 'yes');
    meta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  } catch (e) {}
})();
</script>
<style id="hermes-build-fit-css">
@media screen and (max-width: 760px) {
  html {
    width: 100%;
    max-width: 100vw;
    overflow-x: hidden;
    background: #0b0f11;
    -webkit-text-size-adjust: 100%;
  }
  body {
    width: 100vw !important;
    min-width: 0 !important;
    max-width: 100vw !important;
    overflow-x: hidden !important;
    touch-action: pan-x pan-y;
  }
  img, video, canvas, svg {
    max-width: 100%;
  }
  [data-hermes-fit-wrap] {
    display: block;
    width: 100vw;
    max-width: 100vw;
    overflow: auto hidden;
    -webkit-overflow-scrolling: touch;
    margin-left: auto;
    margin-right: auto;
    touch-action: pan-x pan-y;
  }
  [data-hermes-fit-target] {
    transform-origin: top left !important;
    will-change: transform;
    touch-action: pan-x pan-y;
  }
}
</style>`;
  const runtime = `
<script id="hermes-build-fit-runtime">
(function(){
  if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
  var fitted = new WeakSet();
  var fitState = new WeakMap();
  var activePinch = null;
  var activeFitTarget = null;
  var FIT_SELECTOR = '.sheet,.page,.paper,.document-page,.a4,main';
  var postedFit = false;
  function progress(stage) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'hermes-build-viewer', buildId: ${JSON.stringify(buildId)}, stage: stage }, window.location.origin);
      }
    } catch (e) {}
  }
  function clampPage() {
    var de = document.documentElement;
    var body = document.body;
    de.style.width = '100vw';
    de.style.minWidth = '0';
    de.style.maxWidth = '100vw';
    de.style.overflowX = 'hidden';
    if (body) {
      body.style.width = '100vw';
      body.style.minWidth = '0';
      body.style.maxWidth = '100vw';
      body.style.overflowX = 'hidden';
    }
  }
  function unwrap(el) {
    var parent = el && el.parentElement;
    if (!parent || !parent.hasAttribute('data-hermes-fit-wrap')) return;
    parent.style.height = '';
    parent.style.minHeight = '';
    parent.style.overflowX = '';
    el.style.transform = '';
    el.style.width = '';
  }
  function shouldFit(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.closest('[data-hermes-fit-wrap]') && !el.hasAttribute('data-hermes-fit-target')) return false;
    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (el.matches('.slide') && rect.width <= window.innerWidth + 8) return false;
    if (el.matches('.sheet,.page,.paper,.document-page,.a4')) return true;
    return rect.width > window.innerWidth + 24 && rect.height > 120;
  }
  function isDocumentLike(el) {
    return el.matches('.sheet,.page,.paper,.document-page,.a4');
  }
  function ensureWrap(el) {
    var parent = el.parentElement;
    if (parent && parent.hasAttribute('data-hermes-fit-wrap')) return parent;
    var wrap = document.createElement('div');
    wrap.setAttribute('data-hermes-fit-wrap', '');
    parent.insertBefore(wrap, el);
    wrap.appendChild(el);
    el.setAttribute('data-hermes-fit-target', '');
    return wrap;
  }
  function clearOtherFitTargets(keep) {
    Array.prototype.slice.call(document.querySelectorAll('[data-hermes-fit-target]')).forEach(function(el) {
      if (el !== keep) el.removeAttribute('data-hermes-fit-target');
    });
  }
  function applyFit(el, state) {
    var viewport = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
    var viewportH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var scale = Math.max(0.2, Math.min(5, state.baseScale * state.userScale));
    var wrap = ensureWrap(el);
    el.style.width = state.width + 'px';
    el.style.transform = 'scale(' + scale + ')';
    wrap.style.height = Math.ceil(state.height * scale) + 'px';
    wrap.style.minHeight = Math.min(viewportH, Math.ceil(state.height * scale)) + 'px';
    wrap.style.overflowX = state.width * scale > viewport + 2 ? 'auto' : 'hidden';
    if (state.centerX && state.width * scale > viewport + 2) {
      requestAnimationFrame(function(){
        wrap.scrollLeft = Math.max(0, Math.round((state.width * scale - viewport) / 2));
      });
    }
  }
  function fitOne(el) {
    if (activePinch) return;
    unwrap(el);
    var rect = el.getBoundingClientRect();
    var viewport = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
    var viewportH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var available = Math.max(1, viewport - 0);
    if (!rect.width || !rect.height) return;
    var widthScale = available / rect.width;
    var heightScale = viewportH / rect.height;
    var documentLike = isDocumentLike(el);
    var scale = Math.min(1, widthScale);
    var centerX = false;
    if (documentLike && rect.height * scale < viewportH * 0.88) {
      scale = Math.min(1, heightScale);
      centerX = rect.width * scale > viewport + 2;
    }
    if (scale >= 0.995 && rect.width <= available + 2) return;
    var previous = fitState.get(el);
    var state = {
      width: rect.width,
      height: rect.height,
      baseScale: scale,
      userScale: previous && previous.userScale ? previous.userScale : 1,
      centerX: centerX
    };
    activeFitTarget = el;
    clearOtherFitTargets(el);
    fitState.set(el, state);
    applyFit(el, state);
    fitted.add(el);
  }
  function targetFromTouch(target) {
    if (activeFitTarget && fitState.get(activeFitTarget)) return activeFitTarget;
    var first = document.querySelector('[data-hermes-fit-target]');
    return first && fitState.get(first) ? first : null;
  }
  function touchDistance(touches) {
    var a = touches[0];
    var b = touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  function fitAll() {
    if (activePinch) return;
    if (window.visualViewport && window.visualViewport.scale && window.visualViewport.scale !== 1) return;
    clampPage();
    var els = Array.prototype.slice.call(document.querySelectorAll(FIT_SELECTOR)).filter(shouldFit);
    var target = chooseFitTarget(els);
    if (target) fitOne(target);
    var bodyRect = document.body && document.body.getBoundingClientRect ? document.body.getBoundingClientRect() : null;
    if (bodyRect && bodyRect.width > (window.innerWidth || 0) + 24) {
      document.body.style.width = '100vw';
    }
    if (!postedFit) {
      postedFit = true;
      progress('fit');
    }
  }
  function chooseFitTarget(els) {
    if (!els.length) return null;
    var viewport = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
    var viewportH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var best = null;
    var bestScore = -Infinity;
    els.forEach(function(el) {
      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var documentLike = isDocumentLike(el);
      var overWide = rect.width > viewport + 8 ? 1 : 0;
      var fillsHeight = rect.height > viewportH * 0.55 ? 1 : 0;
      var score = rect.width * rect.height;
      if (documentLike) score += 100000000;
      if (el.matches('main')) score += 20000000;
      score += overWide * 10000000 + fillsHeight * 5000000;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    });
    return best;
  }
  var raf = 0;
  function schedule() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fitAll);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  window.addEventListener('load', schedule, { once: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', function(){ setTimeout(schedule, 250); }, { passive: true });
  document.addEventListener('touchstart', function(e) {
    if (!e.touches || e.touches.length !== 2) return;
    var target = targetFromTouch(e.target);
    if (!target) return;
    var state = fitState.get(target);
    if (!state) return;
    activePinch = {
      target: target,
      startDistance: touchDistance(e.touches),
      startScale: state.userScale || 1
    };
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    if (!activePinch || !e.touches || e.touches.length !== 2 || activePinch.startDistance <= 0) return;
    e.preventDefault();
    var state = fitState.get(activePinch.target);
    if (!state) return;
    var ratio = touchDistance(e.touches) / activePinch.startDistance;
    state.userScale = Math.max(0.65, Math.min(4, activePinch.startScale * ratio));
    fitState.set(activePinch.target, state);
    applyFit(activePinch.target, state);
  }, { passive: false });
  document.addEventListener('touchend', function(e) {
    if (!e.touches || e.touches.length < 2) activePinch = null;
  }, { passive: true });
  document.addEventListener('touchcancel', function() {
    activePinch = null;
  }, { passive: true });
  setTimeout(schedule, 250);
  setTimeout(schedule, 900);
})();
</script>`;

  let out = html.replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/gi, "");
  if (/<base\s/i.test(out)) {
    out = out.replace(/<base\b[^>]*>/i, `<base href="${baseHref}">`);
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}${preflight}`);
  } else {
    out = `${preflight}${out}`;
  }
  if (/<\/body>/i.test(out)) {
    return out.replace(/<\/body>/i, `${runtime}</body>`);
  }
  return `${out}${runtime}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; file: string[] }> }
) {
  const { id, file } = await params;
  const buildId = safeDecodeURIComponent(id).trim();
  const rel = safeRelativePath(file.map(safeDecodeURIComponent));
  if (!buildId || !rel) {
    return Response.json({ error: "Invalid build file" }, { status: 400 });
  }

  const app = await findBuildListAppById(buildId);
  if (!app?.appFolder) {
    return Response.json({ error: "Build not found" }, { status: 404 });
  }

  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const buildRoot = path.resolve(root, app.appFolder);
  const fullPath = path.resolve(buildRoot, rel);
  if (fullPath !== buildRoot && !fullPath.startsWith(`${buildRoot}${path.sep}`)) {
    return Response.json({ error: "Invalid build file" }, { status: 400 });
  }

  const st = await stat(fullPath).catch(() => null);
  if (!st?.isFile()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const range = parseRange(req.headers.get("range"), st.size);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Type": contentTypeFor(rel),
    "X-Content-Type-Options": "nosniff",
  });

  if (!range && /\.(html|htm)$/i.test(rel)) {
    const html = await readFile(fullPath, "utf8");
    const body = injectMobileBuildFit(html, buildId);
    headers.delete("Accept-Ranges");
    return new Response(body, { status: 200, headers });
  }

  if (range) {
    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${st.size}`);
    return new Response(
      Readable.toWeb(createReadStream(fullPath, range)) as ReadableStream,
      { status: 206, headers }
    );
  }

  headers.set("Content-Length", String(st.size));
  return new Response(Readable.toWeb(createReadStream(fullPath)) as ReadableStream, {
    status: 200,
    headers,
  });
}
