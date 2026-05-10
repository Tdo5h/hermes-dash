function envBool(raw: string | undefined, defaultTrue = false): boolean {
  if (raw === undefined || raw === "") return defaultTrue;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function sharedVaultAutoIngestEnv(): {
  enabled: boolean;
  maxAttempts: number;
  cooldownMs: number;
  circuitMaxFailures: number;
  circuitPauseMs: number;
  scanThrottleMs: number;
} {
  const maxRaw = process.env.SHARED_VAULT_AUTO_INGEST_MAX_ATTEMPTS?.trim();
  const maxAttempts = Math.min(
    20,
    Math.max(0, maxRaw ? parseInt(maxRaw, 10) : 2) || 2
  );
  const cd = process.env.SHARED_VAULT_AUTO_INGEST_COOLDOWN_MS?.trim();
  const cooldownMs = Math.max(
    60_000,
    cd ? parseInt(cd, 10) : 3_600_000
  );
  const scan = process.env.SHARED_VAULT_AUTO_INGEST_SCAN_THROTTLE_MS?.trim();
  const scanThrottleMs = Math.max(60_000, scan ? parseInt(scan, 10) : 300_000);
  const circ = process.env.SHARED_VAULT_CIRCUIT_MAX_FAILURES?.trim();
  const circuitMaxFailures = Math.max(0, circ ? parseInt(circ, 10) : 3);
  const pause = process.env.SHARED_VAULT_CIRCUIT_PAUSE_MS?.trim();
  const circuitPauseMs = Math.max(3_600_000, pause ? parseInt(pause, 10) : 86_400_000);
  const enabled = envBool(process.env.SHARED_VAULT_AUTO_INGEST_ENABLED, true);
  return {
    enabled,
    maxAttempts,
    cooldownMs,
    circuitMaxFailures,
    circuitPauseMs,
    scanThrottleMs,
  };
}
