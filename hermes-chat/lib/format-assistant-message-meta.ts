import { isHermesGatewayModelLabel } from "@/lib/model-display";
import {
  type UsdBaseRates,
  formatMoneyLine,
} from "@/lib/display-currency";
import { totalInferenceUsdFromAssistantMessage } from "@/lib/inference-total-usd";
import type {
  ChatCostBasis,
  ChatCostSource,
  ChatUsageTokens,
  InferenceBreakdownEntry,
} from "@/lib/sessions";

const MODEL_ALIASES: Record<string, string> = {
  "nvidia/nemotron-3-super-120b-a12b:free": "Nemotron",
  "z-ai/glm-5.1": "GLM-5.1",
  "z-ai/glm-4.6v": "GLM-4.6V",
  "z-ai/glm-4.5v": "GLM-4.5V",
  "z-ai/glm-5v-turbo": "GLM-5V",
  "google/gemma-4-31b-it:free": "Gemma-4-31B",
  "nvidia/nemotron-nano-12b-v2-vl:free": "Nemotron-VL",
};

export function getModelAlias(model: string): string {
  const stripped = model.replace(/^openrouter\//, "");
  return (
    MODEL_ALIASES[stripped] || MODEL_ALIASES[model] || stripped.split("/").pop() || model
  );
}

export type AssistantMetaMessage = {
  role: string;
  model?: string | null;
  modelIdRaw?: string | null;
  costUsd?: number | null;
  toolCostUsd?: number | null;
  promptCostUsd?: number | null;
  completionCostUsd?: number | null;
  costSource?: ChatCostSource | null;
  costBasis?: ChatCostBasis | null;
  toolModels?: string[];
  validatorModel?: string | null;
  /** When the assistant message was received / saved (ms or ISO). */
  timestamp?: number | string | null;
  /** If cost fields are missing on older rows but tokens exist, still show a $0 money line. */
  usageTokens?: ChatUsageTokens | null;
  inferenceBreakdown?: InferenceBreakdownEntry[];
};

function inferenceTimestampParts(
  timestamp: number | string | null | undefined
): string {
  if (timestamp == null) return "";
  const d = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  if (isNaN(d.getTime())) return "";
  const h = d.getHours() % 12 || 12;
  const min = d.getMinutes().toString().padStart(2, "0");
  const ampm = d.getHours() >= 12 ? "pm" : "am";
  const timeStr = `${h.toString().padStart(2, "0")}:${min}${ampm}`;
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const yy = (d.getFullYear() % 100).toString().padStart(2, "0");
  const dateStr = `${dd}/${mm}/${yy}`;
  return `${dateStr} ${timeStr}`;
}

/**
 * Footer under assistant: models, one total cost in display currency, optional source hints, and received time.
 */
export function formatAssistantMessageMeta(
  msg: AssistantMetaMessage,
  displayCurrency: string,
  rates: UsdBaseRates,
  primaryModelFallback: string | null
): { line: string; title?: string } | null {
  if (msg.role !== "assistant") return null;

  const idLine: string[] = [];
  if (msg.inferenceBreakdown?.length) {
    for (const e of msg.inferenceBreakdown) {
      const t = (e.model || "").trim();
      if (t && !isHermesGatewayModelLabel(t)) idLine.push(t);
    }
  }
  if (!idLine.length && msg.toolModels?.length) {
    for (const tm of msg.toolModels) {
      const t = (tm || "").trim();
      if (t && !isHermesGatewayModelLabel(t) && !idLine.includes(t)) idLine.push(t);
    }
  }
  const modelSource =
    msg.model && primaryModelFallback && isHermesGatewayModelLabel(msg.model)
      ? primaryModelFallback
      : msg.model || primaryModelFallback || null;
  if (modelSource) {
    const raw = (modelSource || "").trim();
    if (raw && !idLine.includes(raw)) idLine.push(raw);
  }
  if (msg.validatorModel?.trim()) {
    const v = msg.validatorModel.trim();
    if (!idLine.includes(v)) idLine.push(v);
  }

  /** One entry per display alias (first-seen order); same model used in multiple tool/image calls must not repeat. */
  const modelAliasLine = idLine
    .map((id) => getModelAlias(id))
    .filter((a) => a.trim().length > 0)
    .filter((a, i, arr) => arr.indexOf(a) === i);

  const titleBits: string[] = [];
  if (msg.modelIdRaw?.trim()) titleBits.push(msg.modelIdRaw.trim());
  for (const id of idLine) {
    if (id && !titleBits.includes(id)) titleBits.push(id);
  }
  const titleStr = [
    modelAliasLine.length ? modelAliasLine.join(" + ") : "",
    titleBits.length ? titleBits.join(" · ") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const breakdownTitle =
    msg.inferenceBreakdown?.length ?
      msg.inferenceBreakdown
        .map((e) => {
          const a = getModelAlias(e.model);
          let label: string;
          if (e.role === "validator") label = `${a} (validator)`;
          else if (e.role === "tool_stream") label = `${a} (tool)`;
          else if (e.role === "openrouter_image") label = `${a} (image)`;
          else if (e.role === "llm") label = `${a} (LLM)`;
          else label = a;
          if (
            typeof e.costUsd === "number" &&
            Number.isFinite(e.costUsd) &&
            e.costUsd >= 0
          ) {
            const { line } = formatMoneyLine(e.costUsd, displayCurrency, rates);
            const est = e.costBasis === "estimated" ? " est." : "";
            return `${label} ${line}${est}`;
          }
          return label;
        })
        .join(" · ")
    : "";

  const metaTitle =
    [titleStr, breakdownTitle].filter(Boolean).join(" · ") || undefined;

  const totalUsd = totalInferenceUsdFromAssistantMessage(msg);
  const hasTokenFootprint =
    typeof msg.usageTokens?.total_tokens === "number" &&
    Number.isFinite(msg.usageTokens.total_tokens) &&
    msg.usageTokens.total_tokens > 0;
  const hasAnyMoney =
    (typeof msg.costUsd === "number" && Number.isFinite(msg.costUsd)) ||
    (typeof msg.toolCostUsd === "number" && Number.isFinite(msg.toolCostUsd)) ||
    (typeof msg.promptCostUsd === "number" && Number.isFinite(msg.promptCostUsd)) ||
    (typeof msg.completionCostUsd === "number" && Number.isFinite(msg.completionCostUsd)) ||
    hasTokenFootprint;

  const when = inferenceTimestampParts(msg.timestamp);
  if (!hasAnyMoney && modelAliasLine.length === 0 && !when) return null;
  if (!hasAnyMoney && modelAliasLine.length === 0 && when) {
    return { line: when, title: metaTitle };
  }

  if (!hasAnyMoney && modelAliasLine.length > 0) {
    const line = [modelAliasLine.join(" + "), when].filter(Boolean).join(" · ");
    if (!line) return null;
    return {
      line,
      title: metaTitle,
    };
  }

  const { line: moneyLine, usedUsdFallback } = formatMoneyLine(
    totalUsd,
    displayCurrency,
    rates
  );

  const srcBits: string[] = [];
  /** Default stack bills via OpenRouter — omit that label; show models + cost + time only. */
  if (msg.costSource === "nous") srcBits.push("Nous");
  if (msg.costBasis === "estimated") srcBits.push("est.");
  if (usedUsdFallback) srcBits.push("rate n/a (USD)");
  const srcStr = srcBits.length ? ` · ${srcBits.join(" · ")}` : "";

  const modelPart = modelAliasLine.length ? `${modelAliasLine.join(" + ")} · ` : "";
  const core = `${modelPart}${moneyLine}${srcStr}`.trim();
  const line = when ? `${core} · ${when}` : core;
  return {
    line,
    title: metaTitle,
  };
}
