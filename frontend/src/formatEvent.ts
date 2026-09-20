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

export function hoursForEventDay(
  hours: string[] | undefined,
  eventDate: string | undefined,
  timezone?: string,
): string | undefined {
  const weekday = eventWeekday(eventDate, timezone);
  if (!weekday || !hours?.length) {
    return undefined;
  }
  const prefix = `${weekday.toLowerCase()}:`;
  return hours.find((line) => line.trim().toLowerCase().startsWith(prefix));
}

export function formatEventWhenLabel(value: string | undefined): string {
  const when = formatEventWhen(value);
  if (when.date) {
    return when.time ? `${when.date} · ${when.time}` : when.date;
  }
  return "Date not set";
}

export function formatEventWhen(value: string | undefined): { date?: string; time?: string } {
  if (!value) {
    return {};
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const instant = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return { date: formatWeekdayDate(instant) };
  }

  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return { date: value };
  }

  const hasTime = /T\d{2}:\d{2}/.test(value);
  return {
    date: formatWeekdayDate(instant),
    time: hasTime ? formatLocalTime(instant) : undefined,
  };
}

export function formatWeekdayDate(instant: Date): string {
  return instant.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatLocalTime(instant: Date): string {
  return instant
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(" ", "")
    .toLowerCase();
}

export function formatMiles(miles: number): string {
  const label = Number.isInteger(miles) ? String(miles) : String(Number(miles.toFixed(1)));
  return `${label} ${miles === 1 ? "mile" : "miles"}`;
}

export function splitEventDateTime(value: string | undefined): { date: string; time: string } {
  if (!value) {
    return { date: "", time: "" };
  }
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  const time = /T(\d{2}:\d{2})/.exec(value);
  return {
    date: dateOnly?.[1] ?? "",
    time: time?.[1] ?? "",
  };
}

export function milesFromMeters(meters: number | undefined): number {
  if (!meters) {
    return 5;
  }
  return Number((meters / 1609.34).toFixed(1));
}
