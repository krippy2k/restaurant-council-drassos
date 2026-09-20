import { z } from "zod";
import type { CreateEventCommand, Event, EventConstraint, EventSearchArea } from "./types.js";

export const eventConstraintSchema = z.object({
  type: z.string().min(1).max(40),
  strength: z.enum(["required", "preferred"]).default("required"),
});

export const eventCommandDraftSchema = z.object({
  name: z.string().min(1).max(80),
  date: z.string().optional(),
  timezone: z.string().min(1).max(80).optional(),
  locationLabel: z.string().min(1).max(200),
  radiusMiles: z.number().min(0.3).max(31),
  constraints: z.array(eventConstraintSchema).optional(),
  restaurantSearchPolicy: z
    .object({
      minimumOpenAfterEventMinutes: z.number().int().min(15).max(360),
    })
    .optional(),
});

export type EventCommandDraft = z.infer<typeof eventCommandDraftSchema>;

export function clampMiles(value: number): number {
  return Math.min(31, Math.max(0.3, value));
}

export function resolveSearchArea(locationLabel: string, radiusMiles: number): EventSearchArea {
  const miles = clampMiles(radiusMiles);
  const hash = hashString(locationLabel.trim().toLowerCase());
  return {
    displayName: locationLabel.trim(),
    latitude: Number((((hash % 18000) / 100) - 90).toFixed(5)),
    longitude: Number(((((Math.floor(hash / 18000) % 36000) / 100) - 180)).toFixed(5)),
    radiusMeters: Math.round(Math.min(50_000, Math.max(500, miles * 1609.34))),
    source: "address",
  };
}

export function buildCreateEventCommand(
  draft: EventCommandDraft,
  fallbackTimezone: string,
  previous?: CreateEventCommand,
): CreateEventCommand {
  const locationLabel = draft.locationLabel.trim();
  const radiusMiles = clampMiles(draft.radiusMiles);
  const constraints = normalizeConstraints(
    draft.constraints !== undefined ? draft.constraints : previous?.constraints,
  );
  return {
    name: draft.name.trim() || "Dinner",
    date: draft.date?.trim() || undefined,
    timezone: draft.timezone?.trim() || fallbackTimezone,
    locationLabel,
    radiusMiles,
    restaurantSearchPolicy: draft.restaurantSearchPolicy,
    searchArea: resolveSearchArea(locationLabel, radiusMiles),
    ...(constraints.length ? { constraints } : {}),
  };
}

export function eventFromCommand(
  command: CreateEventCommand,
  ownerId: string,
  nowIso: string,
  id: string,
): Event {
  const searchArea = command.searchArea;
  return {
    id,
    ownerId,
    name: command.name,
    date: command.date,
    timezone: command.timezone,
    locationLabel: command.locationLabel,
    location: { latitude: searchArea.latitude, longitude: searchArea.longitude },
    searchArea,
    restaurantSearchPolicy: command.restaurantSearchPolicy,
    constraints: command.constraints,
    status: "draft",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function summarizeCommand(command: CreateEventCommand): string {
  const when = command.date ? ` on ${command.date}` : "";
  return `${command.name}${when} near ${command.locationLabel} (${command.radiusMiles} mi).`;
}

export function normalizeConstraints(
  items?: Array<{ type: string; label?: string; strength?: "required" | "preferred" }>,
): EventConstraint[] {
  const seen = new Set<string>();
  const constraints: EventConstraint[] = [];
  for (const item of items ?? []) {
    const type = item.type.trim().toLowerCase().replace(/\s+/g, "-");
    if (!type || seen.has(type)) {
      continue;
    }
    seen.add(type);
    constraints.push({
      type,
      label: item.label?.trim() || labelForConstraint(type),
      strength: item.strength ?? "required",
    });
  }
  return constraints;
}

export function labelForConstraint(type: string): string {
  if (type === "kid-friendly") {
    return "Kid Friendly";
  }
  return type
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function commandFromEvent(event: Event, fallbackTimezone: string): CreateEventCommand {
  const locationLabel = event.locationLabel?.trim() || event.searchArea?.displayName || "unspecified";
  const radiusMiles = event.searchArea
    ? clampMiles(event.searchArea.radiusMeters / 1609.34)
    : 5;
  return {
    name: event.name,
    date: event.date,
    timezone: event.timezone || fallbackTimezone,
    locationLabel,
    radiusMiles,
    restaurantSearchPolicy: event.restaurantSearchPolicy,
    searchArea: event.searchArea ?? resolveSearchArea(locationLabel, radiusMiles),
    ...(event.constraints?.length ? { constraints: event.constraints } : {}),
  };
}

export function applyCommandToEvent(event: Event, command: CreateEventCommand, nowIso: string): Event {
  const next = eventFromCommand(command, event.ownerId, nowIso, event.id);
  return {
    ...next,
    status: event.status,
    createdAt: event.createdAt,
    updatedAt: nowIso,
  };
}

export function applyFormPatch(
  event: Event,
  patch: {
    name?: string;
    date?: string;
    time?: string;
    locationLabel?: string;
    radiusMiles?: number;
    kidFriendly?: boolean;
    timezone?: string;
  },
  nowIso: string,
  fallbackTimezone: string,
): Event {
  const current = commandFromEvent(event, fallbackTimezone);
  let constraints = current.constraints ?? [];
  if (patch.kidFriendly === true) {
    constraints = normalizeConstraints([...constraints, { type: "kid-friendly" }]);
  } else if (patch.kidFriendly === false) {
    constraints = constraints.filter((item) => item.type !== "kid-friendly");
  }

  const command = buildCreateEventCommand(
    {
      name: patch.name ?? current.name,
      date: combineDateAndTime(patch.date !== undefined ? patch.date : current.date, patch.time),
      timezone: patch.timezone ?? current.timezone,
      locationLabel: patch.locationLabel ?? current.locationLabel,
      radiusMiles: patch.radiusMiles ?? current.radiusMiles,
      constraints,
    },
    fallbackTimezone,
    current,
  );
  return applyCommandToEvent(event, command, nowIso);
}

function combineDateAndTime(date: string | undefined, time: string | undefined): string | undefined {
  const day = date?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!day) {
    return undefined;
  }
  const clock = time?.match(/^(\d{2}:\d{2})/)?.[1];
  return clock ? `${day}T${clock}:00` : day;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
