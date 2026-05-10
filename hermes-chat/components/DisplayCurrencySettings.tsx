"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  DISPLAY_CURRENCY_PRESETS,
  normalizeDisplayCurrencyCode,
  readDisplayCurrencyCode,
} from "@/lib/display-currency";
import { useDisplayCurrency } from "@/lib/use-display-currency";

const PRESET_VALUES: Set<string> = new Set(
  DISPLAY_CURRENCY_PRESETS.map((p) => p.value)
);

/** Preset + custom: labels are ISO codes only. */
const CODE_OPTIONS: { value: string; label: string }[] = [
  ...DISPLAY_CURRENCY_PRESETS.map((p) => ({ value: p.value, label: p.value })),
  { value: "__custom__", label: "…" },
];

function CurrencySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
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
  const current = CODE_OPTIONS.find((o) => o.value === value);
  const display = current?.label ?? value;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`flex max-w-[148px] min-w-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground transition-[box-shadow] duration-200 ${
          open ? "neu-raised-active" : "neu-raised"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-left">{display}</span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <ul
          className="neu-dropdown-panel absolute right-0 top-full z-50 mt-1.5 min-w-[132px] overflow-hidden rounded-lg py-1"
          role="listbox"
        >
          {CODE_OPTIONS.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`
                  neu-dropdown-item block w-full px-2.5 py-1.5 text-left text-xs transition-colors
                  ${o.value === value ? "neu-dropdown-item-active" : "text-muted-foreground"}
                `}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CUSTOM_SENTINEL = "__custom__";

/**
 * Code-only display currency control (default USD). Parent supplies label row (e.g. Settings SettingRow).
 */
export function DisplayCurrencySettings() {
  const { currency, setCurrency } = useDisplayCurrency();
  const [mode, setMode] = useState<"preset" | "custom">(() =>
    PRESET_VALUES.has(readDisplayCurrencyCode()) ? "preset" : "custom"
  );
  const [custom, setCustom] = useState(() =>
    PRESET_VALUES.has(readDisplayCurrencyCode()) ? "" : readDisplayCurrencyCode()
  );

  useEffect(() => {
    if (!PRESET_VALUES.has(currency)) {
      setMode("custom");
      setCustom(currency);
    } else {
      setMode("preset");
    }
  }, [currency]);

  return (
    <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:justify-end">
      <CurrencySelect
        value={mode === "preset" ? currency : CUSTOM_SENTINEL}
        onChange={(v) => {
          if (v === CUSTOM_SENTINEL) {
            setMode("custom");
            const t = (custom || "USD").trim() || "USD";
            setCurrency(t.length === 3 ? t : "USD");
          } else {
            setMode("preset");
            setCurrency(v);
          }
        }}
      />
      {mode === "custom" && (
        <input
          type="text"
          inputMode="text"
          maxLength={3}
          autoCapitalize="characters"
          placeholder="ISO"
          data-hermes-tip="Use a 3-letter currency code, like NZD or USD."
          className="neu-raised w-[4.5rem] rounded-lg px-2.5 py-1.5 text-left text-xs text-sidebar-foreground placeholder:text-muted-foreground/60"
          value={custom}
          onChange={(e) => {
            const next = e.target.value
              .replace(/[^A-Za-z]/g, "")
              .slice(0, 3)
              .toUpperCase();
            setCustom(next);
          }}
          onBlur={() => {
            if (custom.length === 3) {
              setCurrency(normalizeDisplayCurrencyCode(custom));
            } else if (custom.length === 0) {
              setCurrency("USD");
              setMode("preset");
            }
          }}
        />
      )}
    </div>
  );
}
