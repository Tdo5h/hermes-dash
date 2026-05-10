"use client";

import {
  XIcon,
  TypeIcon,
  BellIcon,
  BrainIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CpuIcon,
  CoinsIcon,
  InfoIcon,
  MoonIcon,
  SparklesIcon,
  SunIcon,
  Volume2Icon,
} from "lucide-react";
import { DisplayCurrencySettings } from "@/components/DisplayCurrencySettings";
import Link from "next/link";
import { useSettings } from "@/app/chat/layout";
import type { ThemeMode } from "@/lib/auto-theme";
import { useState, useRef, useEffect } from "react";
import { DEEPGRAM_TTS_VOICE_OPTIONS } from "@/lib/deepgram-tts-voices";
import {
  type OpenRouterCreditsPayload,
  OPENROUTER_CREDITS_TOP_UP_URL,
  formatOpenRouterUsd,
} from "@/lib/openrouter-credits";
import {
  isOpenRouterLowBalance,
  openRouterLowBalanceThresholdUsd,
  openRouterUnderThresholdHintUsd,
  parseStackActiveTier,
} from "@/lib/openrouter-credit-thresholds";
import { isCodexProvider, isOpenRouterProvider, type PresetId } from "@/lib/or-model-ids";
import {
  ensurePushSubscription,
  getPushClientStatus,
  pushClientSupported,
  unsubscribePushNotifications,
} from "@/lib/push-client";

/** Last seen server build id; when it differs from the API, we record `LS_BUILD_CHANGED_AT`. */
const LS_BUILD_ID = "hermeschat-settings-server-build-id";
const LS_BUILD_CHANGED_AT = "hermeschat-settings-server-build-changed-at";

function formatDurationSince(fromMs: number, now: number): string {
  const diff = Math.max(0, now - fromMs);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const TEXT_SIZES = [
  { value: "default", label: "Default" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "custom", label: "Custom" },
] as const;

export type TextSize = (typeof TEXT_SIZES)[number]["value"];

const THEME_MODES = [
  { value: "auto", label: "Auto" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

function SettingRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-0.5 pt-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90">
      {children}
    </div>
  );
}

function SelectDropdown({
  value,
  options,
  onChange,
  panelClassName,
  triggerClassName,
  compact,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  /** e.g. max height for long lists */
  panelClassName?: string;
  /** Extra classes on trigger */
  triggerClassName?: string;
  /** Smaller text + truncate for long labels */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`flex max-w-[148px] min-w-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground transition-[box-shadow] duration-200 ${
          open ? "neu-raised-active" : "neu-raised"
        } ${triggerClassName ?? ""}`}
      >
        <span
          className={
            compact ? "min-w-0 flex-1 truncate text-left" : "min-w-0 flex-1 truncate text-left"
          }
        >
          {current?.label}
        </span>
        <ChevronDownIcon
          className="size-3 shrink-0 text-muted-foreground"
        />
      </button>
      {open && (
        <div
          className={`neu-dropdown-panel absolute right-0 top-full z-50 mt-1.5 min-w-[132px] overflow-hidden rounded-lg py-1 ${panelClassName ?? ""}`}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`
                neu-dropdown-item block w-full px-2.5 py-1.5 text-left text-xs transition-colors
                ${opt.value === value ? "neu-dropdown-item-active" : "text-muted-foreground"}
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  ariaLabel,
  onLabel = "Yes",
  offLabel = "No",
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={() => onChange(!on)}
      className="relative inline-grid h-8 w-[76px] grid-cols-2 items-center overflow-hidden rounded-lg border border-[var(--sidebar-button-border)] bg-[var(--sidebar-depth-input)] text-[10px] font-medium uppercase text-muted-foreground shadow-[var(--sidebar-neu-inset)] outline-none transition-colors focus-visible:border-[var(--sidebar-button-border-hover)] focus-visible:ring-0"
    >
      <span
        aria-hidden
        className={`absolute left-0.5 top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-md bg-[var(--sidebar-depth-selected)] shadow-[var(--sidebar-neu-selected)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          on ? "translate-x-[calc(100%+2px)]" : "translate-x-0"
        }`}
      />
      <span
        className={`relative z-10 flex items-center justify-center px-1 transition-colors ${
          on ? "text-muted-foreground/55" : "text-primary-foreground"
        }`}
      >
        {offLabel}
      </span>
      <span
        className={`relative z-10 flex items-center justify-center px-1 transition-colors ${
          on ? "text-primary-foreground" : "text-muted-foreground/55"
        }`}
      >
        {onLabel}
      </span>
    </button>
  );
}

function useNotificationToggle() {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!pushClientSupported()) return;
    setSupported(true);

    getPushClientStatus()
      .then((status) => {
        setEnabled(status === "enabled");
        setBlocked(status === "blocked");
      })
      .catch(() => {
        setEnabled(false);
        setBlocked(false);
      });
  }, []);

  async function toggle(on: boolean) {
    setEnabled(on);
    try {
      if (on) {
        await ensurePushSubscription();
        setBlocked(false);
      } else {
        await unsubscribePushNotifications();
      }
    } catch {
      setEnabled(!on);
      const status = await getPushClientStatus().catch(() => null);
      setBlocked(status === "blocked");
    }
  }

  return { enabled, supported, blocked, toggle };
}

export function SettingsPanel() {
  const {
    settingsOpen,
    closeSettings,
    textSize,
    setTextSize,
    theme,
    themeMode,
    setTheme,
    thinkingOutputAuto,
    setThinkingOutputAuto,
    hoverTipsEnabled,
    setHoverTipsEnabled,
    ttsVoice,
    setTtsVoice,
  } = useSettings();
  const notifications = useNotificationToggle();
  const [deployBuildId, setDeployBuildId] = useState<string | null>(null);
  const [buildChangedAt, setBuildChangedAt] = useState<number | null>(null);
  const [, setBuildClockTick] = useState(0);
  const [openRouterCredits, setOpenRouterCredits] = useState<
    OpenRouterCreditsPayload | "loading" | null
  >(null);
  const [openRouterActiveTier, setOpenRouterActiveTier] =
    useState<PresetId | null>(null);
  const [activeMainProvider, setActiveMainProvider] = useState<string | null>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    void fetch("/api/build-id", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { buildId?: string }) => {
        if (!cancelled) setDeployBuildId(d.buildId?.trim() || "(none)");
      })
      .catch(() => {
        if (!cancelled) setDeployBuildId("?");
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    try {
      const at = localStorage.getItem(LS_BUILD_CHANGED_AT);
      if (at) setBuildChangedAt(parseInt(at, 10));
    } catch {
      /* ignore */
    }
  }, [settingsOpen]);

  useEffect(() => {
    if (!deployBuildId || deployBuildId === "?" || deployBuildId === "(none)")
      return;
    const now = Date.now();
    try {
      const prev = localStorage.getItem(LS_BUILD_ID);
      if (prev !== deployBuildId) {
        let nextChanged: number;
        if (prev == null) {
          const existing = localStorage.getItem(LS_BUILD_CHANGED_AT);
          nextChanged = existing == null ? now : parseInt(existing, 10) || now;
        } else {
          nextChanged = now;
        }
        localStorage.setItem(LS_BUILD_ID, deployBuildId);
        localStorage.setItem(LS_BUILD_CHANGED_AT, String(nextChanged));
        setBuildChangedAt(nextChanged);
      } else {
        const at = localStorage.getItem(LS_BUILD_CHANGED_AT);
        if (at) {
          const ms = parseInt(at, 10);
          if (Number.isFinite(ms)) setBuildChangedAt(ms);
        }
      }
    } catch {
      setBuildChangedAt(null);
    }
  }, [deployBuildId]);

  useEffect(() => {
    if (!settingsOpen) return;
    const t = setInterval(
      () => setBuildClockTick((n) => n + 1),
      1000
    );
    return () => clearInterval(t);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    setOpenRouterCredits(null);
    setOpenRouterActiveTier(null);
    setActiveMainProvider(null);
    void fetch("/api/hermes/stack", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (stack: {
        config?: { model?: { provider?: string | null } };
        presets?: {
          active?: string;
          presets?: Record<string, { mainProvider?: string | null }>;
        };
      } | null) => {
        if (cancelled) return;
        const activeTier = parseStackActiveTier(stack?.presets?.active);
        if (stack?.presets) {
          setOpenRouterActiveTier(activeTier);
        } else {
          setOpenRouterActiveTier(null);
        }
        const activeProvider =
          (activeTier
            ? stack?.presets?.presets?.[activeTier]?.mainProvider
            : undefined) ??
          stack?.config?.model?.provider ??
          null;
        setActiveMainProvider(activeProvider);
        if (!isOpenRouterProvider(activeProvider ?? undefined) || isCodexProvider(activeProvider ?? undefined)) {
          setOpenRouterCredits(null);
          return;
        }
        setOpenRouterCredits("loading");
        const credits = (await fetch("/api/openrouter/credits", {
          cache: "no-store",
        }).then((r) => r.json())) as OpenRouterCreditsPayload;
        if (!cancelled) setOpenRouterCredits(credits);
      })
      .catch(() => {
        if (!cancelled) {
          setOpenRouterCredits({ ok: false, detail: "fetch_failed" });
          setOpenRouterActiveTier(null);
          setActiveMainProvider(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const usingOpenRouter =
    activeMainProvider !== null &&
    isOpenRouterProvider(activeMainProvider) &&
    !isCodexProvider(activeMainProvider);
  const buildInfoTip = [
    `Server build: ${deployBuildId ?? "loading..."}`,
    buildChangedAt != null && Number.isFinite(buildChangedAt)
      ? `First seen here: ${new Date(buildChangedAt).toLocaleString()}`
      : null,
    buildChangedAt != null && Number.isFinite(buildChangedAt)
      ? `On this device for ${formatDurationSince(buildChangedAt, Date.now())}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <div
        className="fixed inset-0 z-[130] bg-black/50"
        onClick={closeSettings}
      />
      <aside
        data-hermeschat-settings-ui="depth"
        className="settings-depth fixed inset-y-0 right-0 z-[140] flex w-[280px] flex-col border-l border-sidebar-border/25 bg-[var(--sidebar-depth-canvas)] text-sidebar-foreground"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border/25 px-4 py-3">
          <h2
            className="text-sm font-medium text-foreground"
            data-hermes-tip={buildInfoTip}
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={closeSettings}
            className="neu-raised rounded-lg p-2 text-muted-foreground transition-colors hover:text-sidebar-foreground"
            aria-label="Close settings"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <SectionLabel>Display</SectionLabel>
          <div className="neu-raised space-y-0.5 rounded-lg px-3 py-1">
            <SettingRow
              icon={
                themeMode === "auto" ? (
                  <ClockIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : theme === "dark" ? (
                  <MoonIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <SunIcon className="size-4 shrink-0 text-muted-foreground" />
                )
              }
              label="Theme"
            >
              <SelectDropdown
                value={themeMode}
                options={THEME_MODES}
                onChange={(v) => setTheme(v as ThemeMode)}
                compact
              />
            </SettingRow>
            <div className="h-px bg-sidebar-border/30" />
            <SettingRow
              icon={<TypeIcon className="size-4 shrink-0 text-muted-foreground" />}
              label="Text size"
            >
              <SelectDropdown
                value={textSize}
                options={TEXT_SIZES}
                onChange={(v) => setTextSize(v as TextSize)}
              />
            </SettingRow>
            {usingOpenRouter ? (
              <>
                <div className="h-px bg-sidebar-border/30" />
                <SettingRow
                  icon={<CoinsIcon className="size-4 shrink-0 text-muted-foreground" />}
                  label="Display currency"
                >
                  <DisplayCurrencySettings />
                </SettingRow>
              </>
            ) : null}
          </div>

          <SectionLabel>Chat</SectionLabel>
          <div className="neu-raised rounded-lg px-3 py-1">
            <SettingRow
              icon={<BrainIcon className="size-4 shrink-0 text-muted-foreground" />}
              label="Auto-expand thinking"
            >
              <Toggle
                on={thinkingOutputAuto}
                onChange={setThinkingOutputAuto}
                ariaLabel="Automatically expand thinking details under the agent orb"
                onLabel="On"
                offLabel="Off"
              />
            </SettingRow>
            <div className="h-px bg-sidebar-border/30" />
            <SettingRow
              icon={<InfoIcon className="size-4 shrink-0 text-muted-foreground" />}
              label="Hover tips"
            >
              <Toggle
                on={hoverTipsEnabled}
                onChange={setHoverTipsEnabled}
                ariaLabel="Toggle delayed hover helper tips"
                onLabel="On"
                offLabel="Off"
              />
            </SettingRow>
          </div>

          <SectionLabel>Voice</SectionLabel>
          <div className="neu-raised rounded-lg px-3 py-1">
            <SettingRow
              icon={<Volume2Icon className="size-4 shrink-0 text-muted-foreground" />}
              label="Read-aloud voice"
            >
              <SelectDropdown
                value={ttsVoice}
                options={DEEPGRAM_TTS_VOICE_OPTIONS}
                onChange={setTtsVoice}
                compact
                panelClassName="max-h-48 overflow-y-auto min-w-[180px]"
              />
            </SettingRow>
          </div>

          <SectionLabel>Hermes</SectionLabel>
          <div className="neu-raised divide-y divide-sidebar-border/25 overflow-hidden rounded-lg">
            <Link
              href="/chat/skills"
              onClick={closeSettings}
              className="group flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-sidebar-accent/5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground/90 transition-colors group-hover:text-foreground">
                    Skills
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    Local skills and pins
                  </div>
                </div>
              </div>
              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground/80"
                aria-hidden
              />
            </Link>
            <Link
              href="/chat/automations"
              onClick={closeSettings}
              className="group flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-sidebar-accent/5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <CalendarClockIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground/90 transition-colors group-hover:text-foreground">
                    Automations
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    Scheduled Hermes work
                  </div>
                </div>
              </div>
              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground/80"
                aria-hidden
              />
            </Link>
          </div>

          <SectionLabel>Models &amp; API</SectionLabel>
          <div className="neu-raised divide-y divide-sidebar-border/25 rounded-lg overflow-hidden">
            <Link
              href="/chat/models"
              onClick={closeSettings}
              className="group flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-sidebar-accent/5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <CpuIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground/90 transition-colors group-hover:text-foreground">
                    Models &amp; API
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {usingOpenRouter ? "Presets, stack, OpenRouter list" : "Presets and stack routing"}
                  </div>
                </div>
              </div>
              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground/80"
                aria-hidden
              />
            </Link>
            {usingOpenRouter ? (
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <CoinsIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-foreground/90">OpenRouter credits</div>
                  <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                    {openRouterCredits === null || openRouterCredits === "loading" ? (
                      "…"
                    ) : openRouterCredits.ok ? (
                      <>
                        <span
                          className={`font-mono ${
                            isOpenRouterLowBalance(
                              openRouterCredits.remaining,
                              openRouterActiveTier
                            )
                              ? "text-red-500"
                              : "text-foreground/90"
                          }`}
                        >
                          {formatOpenRouterUsd(openRouterCredits.remaining)}
                        </span>{" "}
                        <span
                          className={
                            isOpenRouterLowBalance(
                              openRouterCredits.remaining,
                              openRouterActiveTier
                            )
                              ? "text-red-500"
                              : undefined
                          }
                        >
                          remaining
                        </span>
                        {isOpenRouterLowBalance(
                          openRouterCredits.remaining,
                          openRouterActiveTier
                        ) ? (
                          <div className="mt-0.5 space-y-1 text-red-500">
                            <div>
                              {openRouterUnderThresholdHintUsd(
                                openRouterLowBalanceThresholdUsd(openRouterActiveTier)
                              )}
                            </div>
                            <a
                              href={OPENROUTER_CREDITS_TOP_UP_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block break-all font-mono text-[10px] leading-snug text-red-500 underline underline-offset-2 hover:text-red-400"
                            >
                              {OPENROUTER_CREDITS_TOP_UP_URL}
                            </a>
                          </div>
                        ) : null}
                      </>
                    ) : openRouterCredits.detail === "no_key" ? (
                      "Set OPENROUTER_API_KEY in the stack .env (HermesChat reads it server-side)."
                    ) : openRouterCredits.detail === "forbidden" ? (
                      "This key cannot read credits. Use an OpenRouter management key or set OPENROUTER_MANAGEMENT_KEY for this check only."
                    ) : openRouterCredits.detail === "unauthorized" ? (
                      "Invalid or expired OpenRouter key."
                    ) : (
                      openRouterCredits.message ||
                      "Could not load credits. See OpenRouter status or key settings."
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {notifications.supported && (
            <>
              <SectionLabel>System</SectionLabel>
              <div className="neu-raised rounded-lg px-3 py-1">
                <SettingRow
                  icon={<BellIcon className="size-4 shrink-0 text-muted-foreground" />}
                  label={notifications.blocked ? "Notifications blocked" : "Notifications"}
                >
                  <Toggle
                    on={notifications.enabled}
                    onChange={notifications.toggle}
                    ariaLabel="Toggle notifications"
                  />
                </SettingRow>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
