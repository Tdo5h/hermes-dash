import type { ActiveProcessingEntry } from "@/lib/session-processing-status";

export type ProcessingKind = "architect" | "default";

/**
 * Where background work is running — drives tab “breadcrumbs” and vault-row hints
 * without N requests per vault.
 */
export type ProcessingSurface = {
  /** webchat id → yellow (architect) or blue (default) when that session is processing */
  byWebchatId: Record<string, ProcessingKind>;
  hasMain: boolean;
  hasBuilds: boolean;
  /** vault project slug (same as `projectId` on store rows) */
  vaults: Record<string, { hasActive: boolean; kind: ProcessingKind }>;
  /** webchat ids with active work in the main Chats list (for tab “lead” suppression). */
  mainProcessingWebchatIds: string[];
  buildsProcessingWebchatIds: string[];
  /** webchat ids for any workspace/vault session */
  vaultProcessingWebchatIds: string[];
};

type Row = {
  webchatId: string | null;
  id: string;
  chatType: string;
  projectId: string | null;
};

function pickRowForWebchatId(rows: Row[], webchatId: string): Row | null {
  for (const r of rows) {
    if (r.webchatId && r.webchatId === webchatId) return r;
  }
  for (const r of rows) {
    if (r.id === webchatId) return r;
  }
  return null;
}

function mergeVaultKind(
  cur: { hasActive: boolean; kind: ProcessingKind } | undefined,
  kind: ProcessingKind
): { hasActive: boolean; kind: ProcessingKind } {
  if (!cur) {
    return { hasActive: true, kind };
  }
  return {
    hasActive: true,
    kind: cur.kind === "architect" || kind === "architect" ? "architect" : "default",
  };
}

/**
 * Classify every active processing webchat and aggregate by sidebar area.
 */
export function buildProcessingSurface(
  details: Map<string, ActiveProcessingEntry>,
  rows: Row[]
): ProcessingSurface {
  const byWebchatId: Record<string, ProcessingKind> = {};
  let hasMain = false;
  let hasBuilds = false;
  const vaults: Record<string, { hasActive: boolean; kind: ProcessingKind }> =
    {};
  const mainProcessingWebchatIds: string[] = [];
  const buildsProcessingWebchatIds: string[] = [];
  const vaultProcessingWebchatIds: string[] = [];

  for (const [wid, ent] of details) {
    const kind: ProcessingKind = ent.ingestViaArchitect ? "architect" : "default";
    byWebchatId[wid] = kind;

    const r = pickRowForWebchatId(rows, wid);
    if (!r) continue;

    if (r.chatType === "build_edit" || r.chatType === "creative_studio") {
      hasBuilds = true;
      buildsProcessingWebchatIds.push(wid);
      continue;
    }
    if (r.chatType === "workspace" && r.projectId) {
      const slug = r.projectId.trim();
      if (slug) {
        vaults[slug] = mergeVaultKind(vaults[slug], kind);
        vaultProcessingWebchatIds.push(wid);
      }
      continue;
    }
    if (
      r.chatType !== "workspace" &&
      r.chatType !== "build_edit" &&
      r.chatType !== "creative_studio" &&
      !r.projectId
    ) {
      hasMain = true;
      mainProcessingWebchatIds.push(wid);
    }
  }

  return {
    byWebchatId,
    hasMain,
    hasBuilds,
    vaults,
    mainProcessingWebchatIds,
    buildsProcessingWebchatIds,
    vaultProcessingWebchatIds,
  };
}

/**
 * Merge architect ingest jobs (queued/running) into the surface — they do not write
 * `/tmp/oc-status-*.json` while the worker runs, so tab pips and vault rows would miss them.
 */
export function mergeSharedIngestQueueIntoSurface(
  surface: ProcessingSurface,
  activity: { slugSet: Set<string>; webchatIds: string[] }
): ProcessingSurface {
  if (activity.slugSet.size === 0 && activity.webchatIds.length === 0) {
    return surface;
  }
  const vaults = { ...surface.vaults };
  for (const slug of activity.slugSet) {
    vaults[slug] = mergeVaultKind(vaults[slug], "architect");
  }
  const byWebchatId = { ...surface.byWebchatId };
  const vaultProcessingWebchatIds = [...surface.vaultProcessingWebchatIds];
  for (const wid of activity.webchatIds) {
    if (!wid) continue;
    byWebchatId[wid] = "architect";
    if (!vaultProcessingWebchatIds.includes(wid)) {
      vaultProcessingWebchatIds.push(wid);
    }
  }
  return {
    ...surface,
    vaults,
    byWebchatId,
    vaultProcessingWebchatIds,
  };
}

/**
 * Private-vault Hermes verify/re-ingest (Chat → gateway) — same tracing as architect for vault row /
 * nested chat orbs, but `default` (blue) not yellow.
 */
export function mergePrivateHermesReingestIntoSurface(
  surface: ProcessingSurface,
  activity: { slugSet: Set<string>; webchatIds: string[] }
): ProcessingSurface {
  if (activity.slugSet.size === 0 && activity.webchatIds.length === 0) {
    return surface;
  }
  const vaults = { ...surface.vaults };
  for (const slug of activity.slugSet) {
    vaults[slug] = mergeVaultKind(vaults[slug], "default");
  }
  const byWebchatId = { ...surface.byWebchatId };
  const vaultProcessingWebchatIds = [...surface.vaultProcessingWebchatIds];
  for (const wid of activity.webchatIds) {
    if (!wid) continue;
    if (byWebchatId[wid] !== "architect") {
      byWebchatId[wid] = "default";
    }
    if (!vaultProcessingWebchatIds.includes(wid)) {
      vaultProcessingWebchatIds.push(wid);
    }
  }
  return {
    ...surface,
    vaults,
    byWebchatId,
    vaultProcessingWebchatIds,
  };
}

export function kindForWebchatId(
  surface: ProcessingSurface,
  webchatId: string | null | undefined,
  processing: boolean
): ProcessingKind | undefined {
  if (!processing || !webchatId) return undefined;
  return surface.byWebchatId[webchatId] ?? "default";
}
