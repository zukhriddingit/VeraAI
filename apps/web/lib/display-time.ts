const utcDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

const utcDateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short"
});

const utcFullDateTime = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short"
});

function instant(value: string | Date): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("The display instant is invalid.");
  return parsed;
}

export function formatUtcDate(value: string | Date): string {
  return utcDate.format(instant(value));
}

export function formatUtcDateTime(value: string | Date): string {
  return utcDateTime.format(instant(value));
}

export function formatUtcFullDateTime(value: string | Date): string {
  return utcFullDateTime.format(instant(value));
}
