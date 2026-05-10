import { isHermesGatewayModelLabel } from "@/lib/model-display";
import type {
  HermesInferenceChainStep,
  InferenceBreakdownEntry,
} from "@/lib/sessions";

function chainRoleToEntryRole(
  r: string | undefined
): NonNullable<InferenceBreakdownEntry["role"]> {
  const s = (r || "").toLowerCase();
  if (s === "openrouter_image" || s === "image") return "openrouter_image";
  if (s === "llm" || s === "agent") return "llm";
  if (s === "validator") return "validator";
  return "tool_stream";
}

function chainStepToEntry(step: HermesInferenceChainStep): InferenceBreakdownEntry | null {
  const t = step.model?.trim();
  if (!t || isHermesGatewayModelLabel(t)) return null;
  const role = chainRoleToEntryRole(step.role);
  const cb = step.cost_basis;
  const costBasis =
    cb === "estimated" || cb === "reported" ? cb : cb ? String(cb) : undefined;
  const c = step.cost_usd;
  const costUsd =
    typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : null;
  return {
    model: t,
    role,
    ...(costUsd !== null ? { costUsd } : {}),
    ...(costBasis ? { costBasis } : {}),
  };
}

/**
 * Build per-step inference rows for the assistant footer. Prefer the gateway
 * ``hermes_inference_chain`` (LLM + OpenRouter image native costs); fall back to
 * catalog model / validator / streamed tool model ids.
 */
export function buildInferenceBreakdown(args: {
  displayModel: string | null | undefined;
  validatorModel: string | null | undefined;
  toolModels: string[];
  hermesInferenceChain?: HermesInferenceChainStep[] | null;
}): InferenceBreakdownEntry[] | undefined {
  if (args.hermesInferenceChain?.length) {
    const rows: InferenceBreakdownEntry[] = [];
    for (const step of args.hermesInferenceChain) {
      const e = chainStepToEntry(step);
      if (e) rows.push(e);
    }
    return rows.length > 0 ? rows : undefined;
  }

  const rows: InferenceBreakdownEntry[] = [];
  const push = (
    model: string | null | undefined,
    role: NonNullable<InferenceBreakdownEntry["role"]>
  ) => {
    const t = model?.trim();
    if (!t || isHermesGatewayModelLabel(t)) return;
    if (rows.some((r) => r.model === t)) return;
    rows.push({ model: t, role });
  };
  push(args.displayModel, "main");
  push(args.validatorModel, "validator");
  for (const m of args.toolModels) push(m, "tool_stream");
  return rows.length > 0 ? rows : undefined;
}
