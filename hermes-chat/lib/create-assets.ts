import { readFile } from "fs/promises";
import path from "path";
import { getHermesChatDataDir } from "@/lib/hermes-config";

type CreateAssetMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
};

export function isCreateAssetId(raw: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(raw.trim());
}

export async function createAssetIdToPath(id: string): Promise<string | null> {
  const clean = id.trim();
  if (!isCreateAssetId(clean)) return null;
  const dir = path.join(getHermesChatDataDir(), "create-assets", clean);
  try {
    const meta = JSON.parse(
      await readFile(path.join(dir, "meta.json"), "utf8")
    ) as CreateAssetMeta;
    if (!meta.name || path.basename(meta.name) !== meta.name) return null;
    return path.join(dir, meta.name);
  } catch {
    return null;
  }
}

export function createAssetIdFromUrl(rawUrl: string): string | null {
  const raw = rawUrl.trim();
  if (!raw) return null;
  try {
    const u = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://hermes.local");
    if (u.pathname !== "/api/create-assets/file") return null;
    const id = u.searchParams.get("id")?.trim() || "";
    return isCreateAssetId(id) ? id : null;
  } catch {
    return null;
  }
}
