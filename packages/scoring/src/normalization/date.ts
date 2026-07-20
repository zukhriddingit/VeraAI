export function normalizeIsoDate(input: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(input.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const instant = new Date(0);
  instant.setUTCHours(0, 0, 0, 0);
  instant.setUTCFullYear(year, month - 1, day);
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseExplicitOffsetInstant(input: string): Date | null {
  const trimmed = input.trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(trimmed)) return null;
  const milliseconds = Date.parse(trimmed);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

export function dateInTimeZone(timestamp: string, timeZone: string): string | null {
  const instant = parseExplicitOffsetInstant(timestamp);
  if (instant === null) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(instant);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const year = byType.get("year");
    const month = byType.get("month");
    const day = byType.get("day");
    if (year === undefined || month === undefined || day === undefined) return null;
    return normalizeIsoDate(`${year}-${month}-${day}`);
  } catch {
    return null;
  }
}
