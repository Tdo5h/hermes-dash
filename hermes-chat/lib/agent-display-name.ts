/**
 * Human-facing assistant name (UI, notifications, optional gateway `X-Title`).
 * Set `AGENT_DISPLAY_NAME` in `.env.local` — assistant display name in the UI and notifications.
 */
function toTitleCaseWords(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function getAgentDisplayName(): string {
  const raw = process.env.AGENT_DISPLAY_NAME?.trim() || "Hermes";
  // Preserve all-caps handles instead of title-casing them.
  if (/^[A-Z0-9]{2,}$/.test(raw)) return raw;
  return toTitleCaseWords(raw);
}
