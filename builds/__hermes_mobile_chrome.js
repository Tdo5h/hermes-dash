(function () {
  "use strict";

  var ROOT_CLASS = "hermes-build-mobile-normalized";
  var FIT_ATTR = "data-hermes-fit-paper";
  var MOBILE_CHROME_COLOR = "#0b0f11";
  var themeObserver = null;

  function isMobileViewport() {
    return window.innerWidth <= 760;
  }

  function ensureMeta(name, content) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", name);
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", content);
    return meta;
  }

  function normalizeMeta() {
    var viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement("meta");
      viewport.setAttribute("name", "viewport");
      document.head.appendChild(viewport);
    }
    var content = viewport.getAttribute("content") || "width=device-width, initial-scale=1";
    if (!/viewport-fit\s*=/.test(content)) content += ", viewport-fit=cover";
    viewport.setAttribute("content", content);

    ensureMeta("mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-capable", "yes");
    if (isMobileViewport()) {
      ensureMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
      ensureMeta("theme-color", MOBILE_CHROME_COLOR);
    }
  }

  function injectStyles() {
    if (document.getElementById("hermes-build-mobile-normalizer")) return;
    var style = document.createElement("style");
    style.id = "hermes-build-mobile-normalizer";
    style.textContent = [
      ":root{--hermes-visible-top:0px;--hermes-visible-bottom:0px;--hermes-visible-height:100dvh;}",
      "html." + ROOT_CLASS + "{min-height:100%;background:Canvas;}",
      "@media screen and (max-width:760px){",
      "html." + ROOT_CLASS + ",html." + ROOT_CLASS + " body{min-height:100%;}",
      "html." + ROOT_CLASS + ",html." + ROOT_CLASS + " body{max-width:100vw;overflow-x:hidden;}",
      "html." + ROOT_CLASS + " body{overscroll-behavior-y:contain;background:#0b0f11;}",
      "html." + ROOT_CLASS + " .slide{top:var(--hermes-visible-top)!important;bottom:var(--hermes-visible-bottom)!important;height:auto!important;max-height:none!important;}",
      "html." + ROOT_CLASS + " .slide{padding-top:max(4.75rem,env(safe-area-inset-top,0px))!important;padding-bottom:max(6.25rem,env(safe-area-inset-bottom,0px))!important;}",
      "html." + ROOT_CLASS + " .slide.is-active{overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;}",
      "html." + ROOT_CLASS + " .slide:not(.is-active){overflow:hidden!important;}",
      "html." + ROOT_CLASS + " .deck-nav,html." + ROOT_CLASS + " .slide-nav,html." + ROOT_CLASS + " .slide-controls,html." + ROOT_CLASS + " .controls,html." + ROOT_CLASS + " .pager{bottom:max(calc(var(--hermes-visible-bottom) + 1rem),calc(env(safe-area-inset-bottom,0px) + 5.25rem))!important;}",
      "html." + ROOT_CLASS + " .deck-counter,html." + ROOT_CLASS + " .slide-counter{bottom:max(calc(var(--hermes-visible-bottom) + 1.2rem),calc(env(safe-area-inset-bottom,0px) + 5.5rem))!important;}",
      "html." + ROOT_CLASS + " .deck-hint{display:none!important;}",
      "html." + ROOT_CLASS + " [class*=nav],html." + ROOT_CLASS + " [class*=controls],html." + ROOT_CLASS + " [class*=pager]{scroll-margin-bottom:max(5.5rem,env(safe-area-inset-bottom,0px));}",
      "html." + ROOT_CLASS + " [data-hermes-paper-wrap]{width:100vw;max-width:100vw;overflow:hidden;display:flex;justify-content:center;align-items:flex-start;margin:0 auto;}",
      "html." + ROOT_CLASS + " [" + FIT_ATTR + "]{max-width:none!important;transform-origin:top center!important;}",
      "}"
    ].join("");
    document.head.appendChild(style);
  }

  function visualMetrics() {
    var vv = window.visualViewport;
    var width = vv ? vv.width : window.innerWidth;
    var height = vv ? vv.height : window.innerHeight;
    var top = vv ? Math.max(0, vv.offsetTop || 0) : 0;
    var bottom = vv ? Math.max(0, window.innerHeight - height - top) : 0;
    return { width: width, height: height, top: top, bottom: bottom };
  }

  function syncVisibleViewport() {
    var m = visualMetrics();
    var root = document.documentElement;
    root.style.setProperty("--hermes-visible-top", m.top + "px");
    root.style.setProperty("--hermes-visible-bottom", m.bottom + "px");
    root.style.setProperty("--hermes-visible-height", m.height + "px");
  }

  function looksLikePaper(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.matches(".sheet,.page,[data-od-id]")) return true;
    var rect = el.getBoundingClientRect();
    return rect.width > 520 && rect.height > rect.width * 1.18;
  }

  function ensurePaperWrapper(el) {
    var parent = el.parentElement;
    if (parent && parent.hasAttribute("data-hermes-paper-wrap")) return parent;
    var wrap = document.createElement("div");
    wrap.setAttribute("data-hermes-paper-wrap", "true");
    parent.insertBefore(wrap, el);
    wrap.appendChild(el);
    return wrap;
  }

  function fitPaperPages() {
    if (!isMobileViewport()) return;
    var candidates = Array.prototype.slice.call(
      document.querySelectorAll(".sheet,.page,main,[data-od-id]")
    ).filter(looksLikePaper);
    if (candidates.length === 0) return;

    var m = visualMetrics();
    var viewportWidth = Math.max(1, document.documentElement.clientWidth || m.width || window.innerWidth);
    document.documentElement.style.overflowX = "hidden";
    if (document.body) document.body.style.overflowX = "hidden";
    candidates.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      var naturalWidth = Math.max(el.scrollWidth || 0, el.offsetWidth || 0, rect.width || 0);
      var naturalHeight = Math.max(el.scrollHeight || 0, el.offsetHeight || 0, rect.height || 0);
      if (!naturalWidth || !naturalHeight) return;
      var scale = Math.min(1, viewportWidth / naturalWidth);
      var wrap = ensurePaperWrapper(el);
      el.setAttribute(FIT_ATTR, "true");
      el.style.width = naturalWidth + "px";
      el.style.transform = "scale(" + scale + ")";
      el.style.marginLeft = "auto";
      el.style.marginRight = "auto";
      wrap.style.height = Math.ceil(naturalHeight * scale) + "px";
    });
  }

  function forceMobileChromeTheme() {
    if (!isMobileViewport()) return;
    ensureMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    var themes = Array.prototype.slice.call(document.querySelectorAll('meta[name="theme-color"]'));
    if (themes.length === 0) themes = [ensureMeta("theme-color", MOBILE_CHROME_COLOR)];
    themes.forEach(function (theme) {
      if (theme.getAttribute("content") !== MOBILE_CHROME_COLOR) {
        theme.setAttribute("content", MOBILE_CHROME_COLOR);
      }
    });
  }

  function watchThemeColor() {
    if (themeObserver || !document.head) return;
    themeObserver = new MutationObserver(function () {
      forceMobileChromeTheme();
    });
    themeObserver.observe(document.head, {
      attributes: true,
      attributeFilter: ["content"],
      childList: true,
      subtree: true
    });
  }

  function scheduleEarlyRepeats() {
    var runs = 0;
    var timer = window.setInterval(function () {
      runs += 1;
      syncAll();
      if (runs >= 12) window.clearInterval(timer);
    }, 400);
  }

  function interceptMobilePdfLinks() {
    if (!isMobileViewport() || document.documentElement.hasAttribute("data-hermes-pdf-link-intercept")) return;
    document.documentElement.setAttribute("data-hermes-pdf-link-intercept", "true");
    document.addEventListener("click", function (event) {
      var target = event.target;
      var link = target && target.closest ? target.closest("a[href]") : null;
      if (!link) return;
      var href = link.getAttribute("href") || "";
      if (!/\/document\.pdf(?:$|[?#])/i.test(href)) return;
      event.preventDefault();
      window.location.href = href.replace(/document\.pdf(?:[?#].*)?$/i, "index.html");
    }, true);
  }

  function watchSlideChanges() {
    document.addEventListener("click", function () {
      window.setTimeout(syncAll, 40);
      window.setTimeout(syncAll, 220);
    }, true);
    document.addEventListener("keydown", function () {
      window.setTimeout(syncAll, 40);
      window.setTimeout(syncAll, 220);
    }, true);
    if (document.body && window.MutationObserver) {
      var bodyObserver = new MutationObserver(function () {
        window.requestAnimationFrame(syncAll);
      });
      bodyObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
        subtree: true
      });
    }
  }

  function syncAll() {
    document.documentElement.classList.add(ROOT_CLASS);
    syncVisibleViewport();
    fitPaperPages();
    forceMobileChromeTheme();
  }

  normalizeMeta();
  injectStyles();
  watchThemeColor();
  interceptMobilePdfLinks();
  syncAll();
  scheduleEarlyRepeats();
  window.addEventListener("load", syncAll, { passive: true });
  window.addEventListener("load", watchSlideChanges, { passive: true });
  window.addEventListener("resize", syncAll, { passive: true });
  window.addEventListener("orientationchange", function () {
    setTimeout(syncAll, 80);
    setTimeout(syncAll, 320);
  }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncAll, { passive: true });
    window.visualViewport.addEventListener("scroll", syncAll, { passive: true });
  }
})();
