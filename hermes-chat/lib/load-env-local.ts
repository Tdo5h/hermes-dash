import { existsSync, readFileSync } from "fs";
import path from "path";

/**
 * Standalone Next in Docker may not merge `env_file` the same as `next dev`.
 * Load `/.env.local` into `process.env` for keys that are still missing (server-only).
 */
export function loadEnvLocalIntoProcess(): void {
  try {
    const p = path.join(process.cwd(), ".env.local");
    if (!existsSync(p)) return;
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key || process.env[key]) continue;
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}
