"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DISPLAY_CURRENCY_EVENT,
  DISPLAY_CURRENCY_STORAGE_KEY,
  type UsdBaseRates,
  readDisplayCurrencyCode,
  writeDisplayCurrencyCode,
} from "@/lib/display-currency";

const FX_URL = "https://open.er-api.com/v6/latest/USD";
const RATES_FRESH_MS = 6 * 60 * 60 * 1000;

let ratesCache: { at: number; rates: UsdBaseRates } | null = null;
let inflight: Promise<UsdBaseRates> | null = null;

export async function fetchUsdBaseRates(): Promise<UsdBaseRates> {
  const now = Date.now();
  if (ratesCache && now - ratesCache.at < RATES_FRESH_MS && ratesCache.rates) {
    return ratesCache.rates;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    let out: UsdBaseRates = null;
    try {
      const res = await fetch(FX_URL, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          rates?: Record<string, number>;
        } | null;
        if (data?.rates && typeof data.rates === "object")
          out = data.rates as UsdBaseRates;
      }
    } catch {
      out = null;
    }
    ratesCache = { at: Date.now(), rates: out };
    return out;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function useDisplayCurrency() {
  const [currency, setCurrencyState] = useState(() => readDisplayCurrencyCode());
  const [rates, setRates] = useState<UsdBaseRates>(null);

  const setCurrency = useCallback((code: string) => {
    writeDisplayCurrencyCode(code);
    setCurrencyState(readDisplayCurrencyCode());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DISPLAY_CURRENCY_STORAGE_KEY)
        setCurrencyState(readDisplayCurrencyCode());
    };
    const onLocal = () => setCurrencyState(readDisplayCurrencyCode());
    window.addEventListener("storage", onStorage);
    window.addEventListener(DISPLAY_CURRENCY_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DISPLAY_CURRENCY_EVENT, onLocal);
    };
  }, []);

  useEffect(() => {
    let stale = false;
    (async () => {
      const r = await fetchUsdBaseRates();
      if (!stale) setRates(r);
    })();
    return () => { stale = true; };
  }, []);

  return { currency, setCurrency, rates };
}
