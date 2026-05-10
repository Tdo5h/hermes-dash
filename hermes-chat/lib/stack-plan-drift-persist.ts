import { isPresetId, type PresetId } from "./or-model-ids";

const STORAGE_KEY = "hermeschat-stack-plan-drift-v1";

export const STACK_PLAN_DRIFT_CHANGED_EVENT = "hermeschat:stack-plan-drift-changed";

export type DriftPresetTier = PresetId;

export type StackPlanDriftPersistedV1 = {
  v: 1;
  revertTo: DriftPresetTier;
  pickedTier: DriftPresetTier;
  pickedLabel: string;
  homeLabel: string;
};

function isDriftTier(s: unknown): s is DriftPresetTier {
  return typeof s === "string" && isPresetId(s);
}

export function readStackPlanDriftPersisted(): StackPlanDriftPersistedV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j.v !== 1) return null;
    if (!isDriftTier(j.revertTo) || !isDriftTier(j.pickedTier)) return null;
    const pickedLabel = typeof j.pickedLabel === "string" ? j.pickedLabel.trim() : "";
    const homeLabel = typeof j.homeLabel === "string" ? j.homeLabel.trim() : "";
    if (!pickedLabel || !homeLabel) return null;
    return {
      v: 1,
      revertTo: j.revertTo,
      pickedTier: j.pickedTier,
      pickedLabel,
      homeLabel,
    };
  } catch {
    return null;
  }
}

export function writeStackPlanDriftPersisted(p: Omit<StackPlanDriftPersistedV1, "v">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...p }));
  } catch {
    /* quota / private mode */
  }
  emitStackPlanDriftChanged();
}

export function clearStackPlanDriftPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emitStackPlanDriftChanged();
}

export function emitStackPlanDriftChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STACK_PLAN_DRIFT_CHANGED_EVENT));
}

/**
 * Drop persisted drift if the live stack no longer matches the one-off switch
 * (reverted, or user chose another tier outside this flow).
 */
export function reconcileStackPlanDriftPersistedWithServer(
  serverActive: DriftPresetTier | null
): void {
  const p = readStackPlanDriftPersisted();
  if (!p || !serverActive) return;
  if (serverActive === p.revertTo || serverActive !== p.pickedTier) {
    clearStackPlanDriftPersisted();
  }
}

/**
 * Call after Model routing Save & apply when the user changed the active plan tier
 * since the stack was last loaded in that form (dropdown edit).
 */
export function clearStackPlanDriftIfUserChangedActiveTier(args: {
  tierInFormWhenSaving: DriftPresetTier;
  tierBaselineFromLastLoad: DriftPresetTier | null;
}): void {
  const { tierInFormWhenSaving, tierBaselineFromLastLoad } = args;
  if (tierBaselineFromLastLoad == null) return;
  if (tierInFormWhenSaving !== tierBaselineFromLastLoad) {
    clearStackPlanDriftPersisted();
  }
}
