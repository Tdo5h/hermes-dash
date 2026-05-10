const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ISO_WALL_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function parseIsoWallTime(raw: string) {
  const match = ISO_WALL_TIME_RE.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
}

function formatClock(hour24: number, minute: number): string {
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatHermesDate(raw: string | null): string {
  if (!raw) return "Not yet";
  const wallTime = parseIsoWallTime(raw);
  if (!wallTime) return raw;
  return `${String(wallTime.day).padStart(2, "0")} ${MONTHS[wallTime.month - 1] ?? ""} ${String(wallTime.year).slice(-2)}`.trim();
}

export function formatHermesDateTime(raw: string | null): string {
  if (!raw) return "Not yet";
  const wallTime = parseIsoWallTime(raw);
  if (!wallTime) return raw;
  return `${String(wallTime.day).padStart(2, "0")} ${MONTHS[wallTime.month - 1] ?? ""}, ${formatClock(wallTime.hour, wallTime.minute)}`.trim();
}
