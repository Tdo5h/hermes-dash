/**
 * Internal heartbeat-only runs (HEARTBEAT_OK, Read HEARTBEAT.md, etc.) can still
 * get an LLM-generated session label like "heartbeat". Those sessions are not user
 * chats — hide them from the sidebar and search.
 */
export function isHeartbeatNoiseLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const t = label.trim().toLowerCase();
  if (t === "heartbeat") return true;
  if (t.startsWith("heartbeat ") && t.length < 56) return true;
  return false;
}
