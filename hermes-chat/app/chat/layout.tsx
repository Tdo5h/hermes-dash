"use client";

import {
  useState,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChatIdentityProvider } from "@/ChatIdentity";
import { ChatSidebar } from "@/components/chat-sidebar";
import { WorkspacesEmptyMain } from "@/components/WorkspacesEmptyMain";
import { NotificationPrompt } from "@/components/notification-prompt";
import { SettingsPanel, type TextSize } from "@/components/settings-panel";
import { HermesHoverTips } from "@/components/HermesHoverTips";
import { DEFAULT_TTS_VOICE, isAllowedTtsModel } from "@/lib/deepgram-tts-voices";
import { warmDeepgramSdk } from "@/lib/deepgram-sdk-load";
import {
  normalizeTimeZone,
  resolveAutoTheme,
  type ThemeMode,
  type ThemeName,
} from "@/lib/auto-theme";
import {
  getCurrentPushSubscriptionEndpoint,
  getPushClientId,
  pushClientSupported,
} from "@/lib/push-client";

interface SidebarContextValue {
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Vault tab is open and the project list is empty — used for the intro canvas on /chat. */
  workspaceZeroHero: boolean;
  setWorkspaceZeroHero: (v: boolean) => void;
}

interface SettingsContextValue {
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
  customTextSizePx: number;
  setCustomTextSizePx: (sizePx: number) => void;
  theme: ThemeName;
  themeMode: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  /** When true, each send opens the expandable thinking trace under the orb; orb label still updates either way. */
  thinkingOutputAuto: boolean;
  setThinkingOutputAuto: (on: boolean) => void;
  /** Enables delayed hover/focus helper tips in Create Studio. */
  hoverTipsEnabled: boolean;
  setHoverTipsEnabled: (on: boolean) => void;
  /** Deepgram Aura TTS voice id for read-aloud */
  ttsVoice: string;
  setTtsVoice: (voice: string) => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  open: false,
  toggle: () => {},
  close: () => {},
  workspaceZeroHero: false,
  setWorkspaceZeroHero: () => {},
});

export const SettingsContext = createContext<SettingsContextValue>({
  settingsOpen: false,
  openSettings: () => {},
  closeSettings: () => {},
  textSize: "default",
  setTextSize: () => {},
  customTextSizePx: 18,
  setCustomTextSizePx: () => {},
  theme: "dark",
  themeMode: "dark",
  setTheme: () => {},
  thinkingOutputAuto: false,
  setThinkingOutputAuto: () => {},
  hoverTipsEnabled: true,
  setHoverTipsEnabled: () => {},
  ttsVoice: DEFAULT_TTS_VOICE,
  setTtsVoice: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function useSettings() {
  return useContext(SettingsContext);
}

const TEXT_SIZE_KEY = "oc-text-size";
const CUSTOM_TEXT_SIZE_PX_KEY = "oc-custom-text-size-px";
const THEME_KEY = "oc-theme";
const THINKING_OUTPUT_AUTO_KEY = "oc-thinking-output-auto";
const HOVER_TIPS_ENABLED_KEY = "oc-hover-tips-enabled";
const TTS_VOICE_KEY = "oc-tts-voice";
/** Service worker posts this after notification tap — see app/sw.ts */
const HERMES_PUSH_NAV_TYPE = "HERMES_PUSH_NAV";
/** Service worker tells open tabs to refetch sessions / transcript (cron webhook, etc.). */
const HERMES_PUSH_SYNC_TYPE = "HERMES_PUSH_SYNC";

function isHttpLikeDocument(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.protocol;
  return p === "http:" || p === "https:";
}

function pathWithSearchAndHash(): string {
  if (typeof window === "undefined") return "/chat";
  return window.location.pathname + window.location.search + window.location.hash;
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workspaceZeroHero, setWorkspaceZeroHero] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [textSize, setTextSizeState] = useState<TextSize>("default");
  const [customTextSizePx, setCustomTextSizePxState] = useState(18);
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark");
  const [theme, setThemeState] = useState<ThemeName>("dark");
  const [autoThemeTimeZone, setAutoThemeTimeZone] = useState(() =>
    normalizeTimeZone()
  );
  const [thinkingOutputAuto, setThinkingOutputAutoState] = useState(false);
  const [hoverTipsEnabled, setHoverTipsEnabledState] = useState(true);
  const [ttsVoice, setTtsVoiceState] = useState<string>(DEFAULT_TTS_VOICE);

  /** Before paint so Settings matches localStorage and avoids a visible “Off” flash. */
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(THINKING_OUTPUT_AUTO_KEY);
      if (raw === "1" || raw === "true") setThinkingOutputAutoState(true);
      const hoverRaw = localStorage.getItem(HOVER_TIPS_ENABLED_KEY);
      if (hoverRaw === "0" || hoverRaw === "false") setHoverTipsEnabledState(false);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(TEXT_SIZE_KEY) as TextSize | null;
    if (
      saved &&
      saved !== "default" &&
      saved !== "medium" &&
      saved !== "large" &&
      saved !== "custom"
    ) {
      localStorage.removeItem(TEXT_SIZE_KEY);
      return;
    }
    if (saved) setTextSizeState(saved);
    const savedCustom = Number(localStorage.getItem(CUSTOM_TEXT_SIZE_PX_KEY));
    if (Number.isFinite(savedCustom) && savedCustom >= 12 && savedCustom <= 28) {
      setCustomTextSizePxState(savedCustom);
    }
  }, []);

  /**
   * Server-side push presence. A service worker can only see clients on the same device, so
   * "do not notify my phone while I am looking at Hermes on another screen" needs a small
   * heartbeat the server can check before sending OS pushes.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const clientId = getPushClientId();
    let endpoint: string | null = null;
    let cancelled = false;

    const loadEndpoint = () => {
      if (!pushClientSupported()) return;
      void getCurrentPushSubscriptionEndpoint()
        .then((value) => {
          if (!cancelled) endpoint = value;
        })
        .catch(() => {
          if (!cancelled) endpoint = null;
        });
    };

    const sendPresence = (keepalive = false) => {
      const body = JSON.stringify({
        clientId,
        path: pathWithSearchAndHash(),
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
        subscriptionEndpoint: endpoint,
      });
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive,
      }).catch(() => {});
    };

    loadEndpoint();
    sendPresence();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadEndpoint();
        sendPresence();
      }
    }, 20_000);
    const onState = () => {
      loadEndpoint();
      sendPresence(true);
    };
    const onPageHide = () => {
      sendPresence(true);
    };
    document.addEventListener("visibilitychange", onState);
    window.addEventListener("focus", onState);
    window.addEventListener("blur", onState);
    window.addEventListener("pageshow", onState);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onState);
      window.removeEventListener("focus", onState);
      window.removeEventListener("blur", onState);
      window.removeEventListener("pageshow", onState);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [pathname]);

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light" || saved === "auto") {
      setThemeModeState(saved);
      setThemeState(saved === "auto" ? resolveAutoTheme(autoThemeTimeZone) : saved);
    }
  }, [autoThemeTimeZone]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/identity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timezone?: string | null } | null) => {
        if (cancelled) return;
        setAutoThemeTimeZone(normalizeTimeZone(d?.timezone));
      })
      .catch(() => {
        if (!cancelled) setAutoThemeTimeZone(normalizeTimeZone());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(TTS_VOICE_KEY);
    if (saved && isAllowedTtsModel(saved)) {
      setTtsVoiceState(saved);
    } else if (saved) {
      localStorage.removeItem(TTS_VOICE_KEY);
    }
  }, []);

  useEffect(() => {
    void warmDeepgramSdk();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/setup/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((status: { ready?: boolean } | null) => {
        if (cancelled) return;
        if (!status?.ready) router.replace("/setup");
      })
      .catch(() => {
        if (!cancelled) router.replace("/setup");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const toggle = useCallback(() => setOpen((p) => !p), []);
  const close = useCallback(() => setOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const setTextSize = useCallback((size: TextSize) => {
    setTextSizeState(size);
    localStorage.setItem(TEXT_SIZE_KEY, size);
  }, []);

  const setCustomTextSizePx = useCallback((sizePx: number) => {
    const next = Math.min(28, Math.max(12, Math.round(sizePx * 10) / 10));
    setCustomTextSizePxState(next);
    setTextSizeState("custom");
    localStorage.setItem(TEXT_SIZE_KEY, "custom");
    localStorage.setItem(CUSTOM_TEXT_SIZE_PX_KEY, String(next));
  }, []);

  const setTheme = useCallback(
    (nextTheme: ThemeMode) => {
      setThemeModeState(nextTheme);
      setThemeState(
        nextTheme === "auto" ? resolveAutoTheme(autoThemeTimeZone) : nextTheme
      );
    },
    [autoThemeTimeZone]
  );

  const setThinkingOutputAuto = useCallback((on: boolean) => {
    setThinkingOutputAutoState(on);
    localStorage.setItem(THINKING_OUTPUT_AUTO_KEY, on ? "1" : "0");
  }, []);

  const setHoverTipsEnabled = useCallback((on: boolean) => {
    setHoverTipsEnabledState(on);
    localStorage.setItem(HOVER_TIPS_ENABLED_KEY, on ? "1" : "0");
  }, []);

  const setTtsVoice = useCallback((voice: string) => {
    if (!isAllowedTtsModel(voice)) return;
    setTtsVoiceState(voice);
    localStorage.setItem(TTS_VOICE_KEY, voice);
  }, []);

  useEffect(() => {
    const sizes = {
      default: "18px",
      medium: "20px",
      large: "22px",
      custom: `${customTextSizePx}px`,
    };
    document.documentElement.style.fontSize = sizes[textSize];
  }, [customTextSizePx, textSize]);

  useEffect(() => {
    let startDistance = 0;
    let startSize = 18;
    let pinching = false;
    let pinchScrollEl: HTMLElement | null = null;

    const distance = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const currentSize = () => {
      const raw = window.getComputedStyle(document.documentElement).fontSize;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 18;
    };

    const findScrollContainer = (target: EventTarget | null): HTMLElement | null => {
      let node = target instanceof HTMLElement ? target : null;
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          node.scrollHeight > node.clientHeight
        ) {
          return node;
        }
        node = node.parentElement;
      }
      return document.scrollingElement instanceof HTMLElement
        ? document.scrollingElement
        : document.documentElement;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      if (document.documentElement.classList.contains("hermes-build-viewer-open")) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      pinching = true;
      startDistance = distance(event.touches);
      startSize = currentSize();
      pinchScrollEl = findScrollContainer(target);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (document.documentElement.classList.contains("hermes-build-viewer-open")) {
        pinching = false;
        pinchScrollEl = null;
        return;
      }
      if (!pinching || event.touches.length !== 2 || startDistance <= 0) return;
      event.preventDefault();
      const scrollEl = pinchScrollEl;
      const beforeHeight = scrollEl?.scrollHeight ?? 0;
      const beforeScroll = scrollEl?.scrollTop ?? 0;
      const scale = distance(event.touches) / startDistance;
      setCustomTextSizePx(startSize * scale);
      requestAnimationFrame(() => {
        if (!scrollEl) return;
        const afterHeight = scrollEl.scrollHeight;
        if (beforeHeight > 0 && afterHeight > 0) {
          scrollEl.scrollTop = (beforeScroll / beforeHeight) * afterHeight;
        }
      });
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinching = false;
        pinchScrollEl = null;
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [setCustomTextSizePx]);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, themeMode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        theme === "dark" ? "#0d1015" : "#e1e4ea"
      );
    }
  }, [theme, themeMode]);

  useEffect(() => {
    if (themeMode !== "auto") return;
    const applyAutoTheme = () => {
      setThemeState(resolveAutoTheme(autoThemeTimeZone));
    };
    applyAutoTheme();
    const interval = window.setInterval(applyAutoTheme, 60000);
    const onVisible = () => {
      if (document.visibilityState === "visible") applyAutoTheme();
    };
    window.addEventListener("focus", applyAutoTheme);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", applyAutoTheme);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoThemeTimeZone, themeMode]);

  /**
   * iOS WebKit: cheap reflow after resume/bfcache only — do not lock height to innerHeight
   * (breaks keyboard / visualViewport). Clears any stale --app-vh from older builds.
   */
  useEffect(() => {
    const nudgeLayout = () => {
      document.documentElement.style.removeProperty("--app-vh");
      requestAnimationFrame(() => {
        void document.documentElement.getBoundingClientRect();
        requestAnimationFrame(() => {
          void document.documentElement.getBoundingClientRect();
        });
      });
    };
    const onVis = () => {
      if (document.visibilityState === "visible") nudgeLayout();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      nudgeLayout();
      if (e.persisted) nudgeLayout();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow as EventListener);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow as EventListener);
    };
  }, []);

  /**
   * Fixed mobile composers use `bottom: var(--hermes-visual-bottom-inset)` so they align with the
   * Visual Viewport bottom (above the virtual keyboard). See:
   * - https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API
   * - https://developer.chrome.com/blog/viewport-resize-behavior/
   * iOS often updates `visualViewport.offsetTop` during keyboard animation on `resize` **and**
   * `scroll`, so skipping `scroll` misses frames; we only sync on rAF-dispatched ticks (no DOM reads
   * in scroll handler beyond scheduling).
   */
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(max-width: 767px)");
    const textInputTypes = new Set([
      "",
      "email",
      "number",
      "password",
      "search",
      "tel",
      "text",
      "url",
    ]);

    const isKeyboardField = (target: Element | null): target is HTMLElement => {
      if (target instanceof HTMLTextAreaElement) return true;
      if (target instanceof HTMLInputElement) return textInputTypes.has(target.type);
      return target instanceof HTMLElement && target.isContentEditable;
    };

    const resetVisualBottomInset = () => {
      root.style.setProperty("--hermes-visual-bottom-inset", "0px");
    };

    const syncVisualBottomInset = () => {
      if (!mq.matches) {
        resetVisualBottomInset();
        return;
      }
      if (root.classList.contains("hermes-build-viewer-open")) {
        resetVisualBottomInset();
        return;
      }
      const vv = window.visualViewport;
      if (!vv) {
        resetVisualBottomInset();
        return;
      }
      if (!isKeyboardField(document.activeElement)) {
        resetVisualBottomInset();
        return;
      }
      if (vv.scale && vv.scale !== 1 && document.activeElement === document.body) {
        resetVisualBottomInset();
        return;
      }
      const inset = Math.max(
        0,
        Math.round(window.innerHeight - vv.offsetTop - vv.height)
      );
      root.style.setProperty("--hermes-visual-bottom-inset", `${inset}px`);
    };

    const schedule = () => requestAnimationFrame(syncVisualBottomInset);

    syncVisualBottomInset();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);

    /** Refocus / route changes sometimes beat the first `resize`; extra ticks match common PWAs */
    const nudgeSoon = () => {
      schedule();
      window.setTimeout(syncVisualBottomInset, 120);
      window.setTimeout(syncVisualBottomInset, 320);
    };
    const clearKeyboardState = () => {
      if (isKeyboardField(document.activeElement)) document.activeElement.blur();
      resetVisualBottomInset();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resetVisualBottomInset();
        nudgeSoon();
      } else {
        clearKeyboardState();
      }
    };
    const onPageShow = () => {
      resetVisualBottomInset();
      nudgeSoon();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", clearKeyboardState);
    window.addEventListener("pageshow", onPageShow);
    const onCustomNudge = () => nudgeSoon();
    window.addEventListener("hermeschat-visual-viewport-nudge", onCustomNudge);

    const onFocusIn = (ev: FocusEvent) => {
      schedule();
      const t = ev.target;
      const isTextField =
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLInputElement &&
          (t.type === "text" ||
            t.type === "search" ||
            t.type === "email" ||
            t.type === "tel" ||
            t.type === "url" ||
            t.type === ""));
      if (isTextField) {
        /** iOS Safari / PWA: keyboard metrics can land after the first frame — staggered syncs. */
        window.setTimeout(syncVisualBottomInset, 0);
        window.setTimeout(syncVisualBottomInset, 50);
        window.setTimeout(syncVisualBottomInset, 120);
        window.setTimeout(syncVisualBottomInset, 280);
        window.setTimeout(syncVisualBottomInset, 500);
      }
    };
    const onFocusOut = () => schedule();
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);

    const t = window.setTimeout(syncVisualBottomInset, 150);
    const t2 = window.setTimeout(syncVisualBottomInset, 600);
    return () => {
      window.removeEventListener("hermeschat-visual-viewport-nudge", onCustomNudge);
      window.clearTimeout(t);
      window.clearTimeout(t2);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", clearKeyboardState);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      resetVisualBottomInset();
    };
  }, []);

  /** Clear notification-route guard only after the target path has mounted. */
  useEffect(() => {
    try {
      const target = sessionStorage.getItem("oc-push-target");
      if (!target) return;
      const current =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      if (current === target) sessionStorage.removeItem("oc-push-target");
    } catch {
      /* ignore */
    }
  }, [pathname]);

  /**
   * iOS PWA: notificationclick uses client.postMessage because WindowClient.navigate()
   * often no-ops. Use Next routing for same-origin paths and keep a fallback for cold wakes.
   */
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;

    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (!d || typeof d !== "object") return;

      if (d.type === HERMES_PUSH_SYNC_TYPE) {
        window.dispatchEvent(new Event("hermeschat-sw-push"));
        return;
      }

      if (d.type !== HERMES_PUSH_NAV_TYPE) return;
      const path = typeof d.path === "string" ? d.path : "";
      if (!path.startsWith("/")) return;
      /** Avoid location.assign from chrome-error / embedded error pages (throws console security errors). */
      if (!isHttpLikeDocument()) return;
      const target = `${path}`;
      const current =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      if (target === current) {
        window.dispatchEvent(new Event("hermeschat-sw-push"));
        return;
      }

      try {
        sessionStorage.setItem("oc-push-target", target);
      } catch {
        /* ignore */
      }

      const go = () => {
        if (!isHttpLikeDocument()) return;
        router.push(target);
        window.setTimeout(() => {
          const cur =
            window.location.pathname +
            window.location.search +
            window.location.hash;
          if (cur !== target && isHttpLikeDocument()) {
            window.location.assign(target);
          }
        }, 650);
      };
      requestAnimationFrame(go);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [router]);

  const showWorkspacesIntro =
    workspaceZeroHero &&
    (pathname === "/chat" || pathname === "/chat/");
  const hideSidebarForGuidedSetup =
    pathname === "/chat/automations/new" || pathname === "/chat/skills/new";

  return (
    <SidebarContext.Provider
      value={{ open, toggle, close, workspaceZeroHero, setWorkspaceZeroHero }}
    >
      <ChatIdentityProvider>
      <SettingsContext.Provider
        value={{
          settingsOpen,
          openSettings,
          closeSettings,
          textSize,
          setTextSize,
          customTextSizePx,
          setCustomTextSizePx,
          theme,
          themeMode,
          setTheme,
          thinkingOutputAuto,
          setThinkingOutputAuto,
          hoverTipsEnabled,
          setHoverTipsEnabled,
          ttsVoice,
          setTtsVoice,
        }}
      >
        <div
          className="flex h-full min-h-0 min-w-0 flex-1 w-screen max-w-[100vw] overflow-hidden bg-[var(--sidebar-depth-canvas)]"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          {open && !hideSidebarForGuidedSetup && (
            <div
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              onClick={close}
            />
          )}

          {!hideSidebarForGuidedSetup && (
            <aside
              className={`
                fixed inset-y-0 left-0 z-40 w-[260px] flex-shrink-0 bg-[var(--sidebar-depth-canvas)] border-r border-sidebar-border/25 transition-transform duration-200 ease-in-out
                md:relative md:translate-x-0
                ${open ? "translate-x-0" : "-translate-x-full"}
              `}
              style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <ChatSidebar />
            </aside>
          )}

          <main className="flex min-h-0 min-w-0 h-full flex-1 flex-col overflow-hidden">
            <NotificationPrompt />
            {showWorkspacesIntro ? <WorkspacesEmptyMain /> : children}
          </main>

          <HermesHoverTips />
          <SettingsPanel />
        </div>
      </SettingsContext.Provider>
      </ChatIdentityProvider>
    </SidebarContext.Provider>
  );
}
