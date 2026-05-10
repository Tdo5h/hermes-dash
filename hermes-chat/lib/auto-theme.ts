export type ThemeName = "dark" | "light";
export type ThemeMode = ThemeName | "auto";

type SolarPoint = {
  lat: number;
  lon: number;
};

const DEFAULT_TIMEZONE = "UTC";

const TIMEZONE_POINTS: Record<string, SolarPoint> = {
  "Pacific/Auckland": { lat: -37.953, lon: 176.99 },
  "Australia/Sydney": { lat: -33.8688, lon: 151.2093 },
  "Australia/Melbourne": { lat: -37.8136, lon: 144.9631 },
  "Europe/London": { lat: 51.5072, lon: -0.1276 },
  "America/New_York": { lat: 40.7128, lon: -74.006 },
  "America/Chicago": { lat: 41.8781, lon: -87.6298 },
  "America/Denver": { lat: 39.7392, lon: -104.9903 },
  "America/Los_Angeles": { lat: 34.0522, lon: -118.2437 },
};

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function degSin(value: number): number {
  return Math.sin((value * Math.PI) / 180);
}

function degCos(value: number): number {
  return Math.cos((value * Math.PI) / 180);
}

function degTan(value: number): number {
  return Math.tan((value * Math.PI) / 180);
}

function degAcos(value: number): number {
  return (Math.acos(value) * 180) / Math.PI;
}

function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 0);
  const current = Date.UTC(year, month - 1, day);
  return Math.floor((current - start) / 86400000);
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const zoned = getZonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute
  );
  return Math.round((zonedAsUtc - date.getTime()) / 60000);
}

function utcHourToLocalMinutes(utcHour: number, offsetMinutes: number): number {
  const minutes = Math.round(utcHour * 60) + offsetMinutes;
  return ((minutes % 1440) + 1440) % 1440;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(timeZone?: string | null): string {
  const trimmed = timeZone?.trim();
  if (trimmed && isValidTimeZone(trimmed)) return trimmed;
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (browser && isValidTimeZone(browser)) return browser;
  return DEFAULT_TIMEZONE;
}

function solarUtcHour(
  year: number,
  month: number,
  day: number,
  point: SolarPoint,
  rising: boolean
): number | null {
  const n = dayOfYear(year, month, day);
  const lngHour = point.lon / 15;
  const t = n + ((rising ? 6 : 18) - lngHour) / 24;
  const meanAnomaly = 0.9856 * t - 3.289;
  const trueLong = normalizeDegrees(
    meanAnomaly +
      1.916 * degSin(meanAnomaly) +
      0.02 * degSin(2 * meanAnomaly) +
      282.634
  );
  let rightAscension =
    (Math.atan(0.91764 * degTan(trueLong)) * 180) / Math.PI;
  rightAscension = normalizeDegrees(rightAscension);
  rightAscension +=
    Math.floor(trueLong / 90) * 90 - Math.floor(rightAscension / 90) * 90;
  rightAscension /= 15;

  const sinDeclination = 0.39782 * degSin(trueLong);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHour =
    (degCos(90.833) - sinDeclination * degSin(point.lat)) /
    (cosDeclination * degCos(point.lat));
  if (cosHour > 1 || cosHour < -1) return null;

  let hourAngle = rising ? 360 - degAcos(cosHour) : degAcos(cosHour);
  hourAngle /= 15;
  const localMeanTime =
    hourAngle + rightAscension - 0.06571 * t - 6.622;
  return ((localMeanTime - lngHour) % 24 + 24) % 24;
}

export function resolveAutoTheme(
  timeZone?: string | null,
  now = new Date()
): ThemeName {
  const tz = normalizeTimeZone(timeZone);
  const point = TIMEZONE_POINTS[tz];
  const local = getZonedParts(now, tz);
  if (!point) {
    const localMinutes = local.hour * 60 + local.minute;
    return localMinutes >= 6 * 60 && localMinutes < 18 * 60 ? "light" : "dark";
  }

  const sunriseHour = solarUtcHour(local.year, local.month, local.day, point, true);
  const sunsetHour = solarUtcHour(local.year, local.month, local.day, point, false);
  if (sunriseHour == null || sunsetHour == null) {
    const localMinutes = local.hour * 60 + local.minute;
    return localMinutes >= 6 * 60 && localMinutes < 18 * 60 ? "light" : "dark";
  }

  const localMinutes = local.hour * 60 + local.minute;
  const offsetMinutes = getTimeZoneOffsetMinutes(now, tz);
  const sunriseMinutes = utcHourToLocalMinutes(sunriseHour, offsetMinutes);
  const sunsetMinutes = utcHourToLocalMinutes(sunsetHour, offsetMinutes);
  if (sunriseMinutes <= sunsetMinutes) {
    return localMinutes >= sunriseMinutes && localMinutes < sunsetMinutes
      ? "light"
      : "dark";
  }
  return localMinutes >= sunriseMinutes || localMinutes < sunsetMinutes
    ? "light"
    : "dark";
}
