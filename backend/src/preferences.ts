import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preferenceLabel } from "./domain/preferences.js";
import type { Preference } from "./domain/types.js";
import { getUserById } from "./users.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const preferencesFile = path.join(dataDir, "preferences.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadPreferences(): Promise<Preference[]> {
  try {
    const raw = await readFile(preferencesFile, "utf8");
    const parsed = JSON.parse(raw) as Preference[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function savePreferences(preferences: Preference[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(preferencesFile, JSON.stringify(preferences, null, 2), "utf8");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function identityKey(preference: Preference): string {
  const value = preference.value ?? {};
  const type = typeof value.type === "string" ? value.type : "";
  const maxDollars = typeof value.maxDollars === "number" ? String(value.maxDollars) : "";
  const label = typeof value.label === "string" ? value.label.trim().toLowerCase() : "";
  return `${preference.eventId}:${preference.userId}:${preference.category}:${type}:${maxDollars}:${label}`;
}

export async function saveEventPreferences(next: Preference[]): Promise<Preference[]> {
  if (next.length === 0) {
    throw Object.assign(new Error("Say a constraint or preference."), { status: 400 });
  }
  return enqueue(async () => {
    const preferences = await loadPreferences();
    const keys = new Set(next.map(identityKey));
    const kept = preferences.filter((item) => !keys.has(identityKey(item)));
    kept.push(...next);
    await savePreferences(kept);
    return next;
  });
}

export type EventPreferenceView = Preference & {
  label: string;
  userName: string;
  mine: boolean;
};

export async function listEventPreferences(eventId: string): Promise<Preference[]> {
  return (await loadPreferences()).filter((item) => item.eventId === eventId);
}

export async function listVisiblePreferences(eventId: string, viewerId: string): Promise<EventPreferenceView[]> {
  const preferences = (await loadPreferences()).filter((item) => item.eventId === eventId);
  const visible = preferences.filter(
    (item) => item.userId === viewerId || item.visibility === "PUBLIC",
  );
  const views = await Promise.all(
    visible.map(async (item) => {
      const user = await getUserById(item.userId);
      return {
        ...item,
        label: preferenceLabel(item),
        userName: user?.name ?? "Guest",
        mine: item.userId === viewerId,
      };
    }),
  );
  return views.sort((left, right) => {
    if (left.mine !== right.mine) {
      return left.mine ? -1 : 1;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}
