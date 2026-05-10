import type { ChatMessage } from "@/lib/sessions";

/**
 * One assistant turn: main completion USD + tool USD, without double-counting
 * `promptCostUsd` + `completionCostUsd` when `costUsd` is already the combined main total.
 */
export function totalInferenceUsdFromAssistantMessage(
  msg: Pick<
    ChatMessage,
    "costUsd" | "toolCostUsd" | "promptCostUsd" | "completionCostUsd"
  >
): number {
  const fin = (n: number) => Number.isFinite(n) && n >= 0;
  const tool =
    typeof msg.toolCostUsd === "number" && fin(msg.toolCostUsd) ? msg.toolCostUsd : 0;
  if (typeof msg.costUsd === "number" && fin(msg.costUsd)) {
    return msg.costUsd + tool;
  }
  const p =
    typeof msg.promptCostUsd === "number" && fin(msg.promptCostUsd)
      ? msg.promptCostUsd
      : 0;
  const c =
    typeof msg.completionCostUsd === "number" && fin(msg.completionCostUsd)
      ? msg.completionCostUsd
      : 0;
  if (p > 0 || c > 0) return p + c + tool;
  return tool;
}
