import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Event } from "./domain/types.js";
import { listJoinedEventIds } from "./members.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const eventsFile = path.join(dataDir, "events.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadEvents(): Promise<Event[]> {
  try {
    const raw = await readFile(eventsFile, "utf8");
    const parsed = JSON.parse(raw) as Event[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveEvents(events: Event[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(eventsFile, JSON.stringify(events, null, 2), "utf8");
}

export async function saveEvent(event: Event): Promise<Event> {
  await enqueue(async () => {
    const events = await loadEvents();
    events.push(event);
    await saveEvents(events);
  });
  return event;
}

export async function listEventsForOwner(ownerId: string): Promise<Event[]> {
  const events = await loadEvents();
  return events
    .filter((event) => event.ownerId === ownerId && typeof event.name === "string")
    .sort((left, right) => {
      const leftAt = left.updatedAt || left.createdAt || "";
      const rightAt = right.updatedAt || right.createdAt || "";
      return rightAt.localeCompare(leftAt);
    });
}

export async function listEventsForUser(userId: string): Promise<Event[]> {
  const [events, joinedIds] = await Promise.all([loadEvents(), listJoinedEventIds(userId)]);
  const joined = new Set(joinedIds);
  return events
    .filter((event) => typeof event.name === "string" && (event.ownerId === userId || joined.has(event.id)))
    .sort((left, right) => {
      const leftAt = left.updatedAt || left.createdAt || "";
      const rightAt = right.updatedAt || right.createdAt || "";
      return rightAt.localeCompare(leftAt);
    });
}

export async function getEventById(id: string): Promise<Event | null> {
  const events = await loadEvents();
  return events.find((event) => event.id === id) ?? null;
}

export async function updateEvent(event: Event): Promise<Event> {
  await enqueue(async () => {
    const events = await loadEvents();
    const index = events.findIndex((item) => item.id === event.id);
    if (index < 0) {
      throw Object.assign(new Error("Event was not found."), { status: 404 });
    }
    events[index] = event;
    await saveEvents(events);
  });
  return event;
}

export async function deleteEvent(id: string): Promise<void> {
  await enqueue(async () => {
    const events = await loadEvents();
    const index = events.findIndex((item) => item.id === id);
    if (index < 0) {
      throw Object.assign(new Error("Event was not found."), { status: 404 });
    }
    events.splice(index, 1);
    await saveEvents(events);
  });
}

function enqueue(work: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
