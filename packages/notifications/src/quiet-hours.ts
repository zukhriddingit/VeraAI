function partsAt(instant: Date, timeZone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value])
  );
  return { hour: Number(parts.hour), minute: Number(parts.minute) };
}

function minuteOfDay(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value))
    throw new Error("Invalid quiet-hours clock time.");
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

export function evaluateQuietHours(
  instantInput: string | Date,
  timeZone: string,
  startsAt: string,
  endsAt: string
): { readonly quiet: boolean; readonly localMinuteOfDay: number } {
  const instant = typeof instantInput === "string" ? new Date(instantInput) : instantInput;
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid quiet-hours instant.");
  const local = partsAt(instant, timeZone);
  const current = local.hour * 60 + local.minute;
  const start = minuteOfDay(startsAt);
  const end = minuteOfDay(endsAt);
  const quiet =
    start === end
      ? false
      : start < end
        ? current >= start && current < end
        : current >= start || current < end;
  return { quiet, localMinuteOfDay: current };
}
