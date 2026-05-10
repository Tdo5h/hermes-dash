/** Gateway cosmetic id — not the provider model id shown in the message footer. */
export function isHermesGatewayModelLabel(id: string | null | undefined): boolean {
  if (!id || typeof id !== "string") return false;
  const t = id.trim().toLowerCase().replace(/\s+/g, " ");
  return t === "hermes-agent" || t === "openclaw" || t === "hermes agent";
}
