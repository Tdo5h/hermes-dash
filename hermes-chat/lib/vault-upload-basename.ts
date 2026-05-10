/**
 * Mirrors server `saveProjectFile` basename sanitization so client-side
 * duplicate checks match uploaded `sources/` names.
 */
export function vaultUploadBasename(originalName: string): string {
  const trimmed = originalName.trim().replace(/\\/g, "/");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "upload";
}

export type VaultFileListEntry = {
  name?: string;
  relativePath?: string;
};

export function vaultFilesContainUploadBasename(
  files: VaultFileListEntry[] | undefined,
  originalFileName: string
): boolean {
  const want = vaultUploadBasename(originalFileName).toLowerCase();
  if (!want) return false;
  for (const f of files ?? []) {
    if (
      typeof f.name === "string" &&
      vaultUploadBasename(f.name).toLowerCase() === want
    ) {
      return true;
    }
    const rp = typeof f.relativePath === "string" ? f.relativePath : "";
    if (rp) {
      const leaf = rp.split("/").pop() ?? "";
      if (vaultUploadBasename(leaf).toLowerCase() === want) return true;
    }
  }
  return false;
}

export async function fetchVaultHasUploadBasename(
  projectSlug: string,
  originalFileName: string
): Promise<boolean> {
  const r = await fetch(
    `/api/projects/${encodeURIComponent(projectSlug)}/files`,
    { cache: "no-store" }
  );
  if (!r.ok) return false;
  const d = (await r.json()) as { files?: VaultFileListEntry[] };
  return vaultFilesContainUploadBasename(d.files, originalFileName);
}
