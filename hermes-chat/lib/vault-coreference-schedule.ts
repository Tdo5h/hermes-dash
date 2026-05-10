import { readProject } from "@/lib/project-service";
import { projectDirFor, type WorkspaceVisibility } from "@/lib/project-paths";
import { runVaultCoreferencePass } from "@/lib/vault-coreference-pass";

function coreferencePassEnabled(): boolean {
  const raw = process.env.VAULT_COREFERENCE_PASS_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

function debounceMs(): number {
  const raw = process.env.VAULT_COREFERENCE_DEBOUNCE_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 500) return Math.floor(n);
  return 4000;
}

const debouncers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * After shared ingest jobs go quiet, rebuild `index/coreference.json` once (debounced per slug).
 */
export function scheduleDebouncedVaultCoreferencePass(projectSlug: string): void {
  if (!coreferencePassEnabled()) return;
  const slug = projectSlug.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!slug) return;
  const prev = debouncers.get(slug);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    debouncers.delete(slug);
    void runVaultCoreferencePassForSlug(slug).catch((e) => {
      console.error("[vault-coreference-schedule]", slug, e);
    });
  }, debounceMs());
  debouncers.set(slug, t);
}

/**
 * Immediate pass (e.g. private reingest completion). Uses on-disk visibility for FS root.
 */
export async function runVaultCoreferencePassForSlug(
  projectSlug: string
): Promise<void> {
  if (!coreferencePassEnabled()) return;
  const slug = projectSlug.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!slug) return;
  const meta = await readProject(slug);
  if (!meta) return;
  const visibility = meta.visibility as WorkspaceVisibility;
  const root = projectDirFor(slug, visibility);
  await runVaultCoreferencePass({
    vaultRootAbs: root,
    vaultSlug: slug,
    visibility,
  });
}
