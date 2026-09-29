export function eventWeekday(value: string | undefined, timezone?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const instant = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return instant.toLocaleDateString("en-US", { weekday: "long" });
  }

  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return undefined;
  }

  return instant.toLocaleDateString("en-US", {
    weekday: "long",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export function weekdayNameFromText(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const tokens = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
  for (const day of WEEKDAYS) {
    if (tokens.includes(day) || tokens.includes(day.slice(0, 3))) {
      return `${day[0]!.toUpperCase()}${day.slice(1)}`;
    }
  }
  return undefined;
}

export function hoursLineForWeekday(hours: string[] | undefined, weekday: string | undefined): string | undefined {
  const day = weekdayNameFromText(weekday);
  if (!day || !hours?.length) {
    return undefined;
  }
  const prefix = `${day.toLowerCase()}:`;
  return hours.find((line) => line.trim().toLowerCase().startsWith(prefix));
}

export function hoursLineForDate(
  hours: string[] | undefined,
  date: string | undefined,
  timezone?: string,
): string | undefined {
  return hoursLineForWeekday(hours, eventWeekday(date, timezone));
}
