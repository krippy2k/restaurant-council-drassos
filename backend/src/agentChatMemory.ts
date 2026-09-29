import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RememberedRestaurant = {
  placeId: string;
  name: string;
};

export type AgentChatMemory = {
  eventId: string;
  restaurants: RememberedRestaurant[];
  updatedAt: string;
};

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const memoryFile = path.join(dataDir, "agent-chat-memory.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadAll(): Promise<AgentChatMemory[]> {
  try {
    const raw = await readFile(memoryFile, "utf8");
    const parsed = JSON.parse(raw) as AgentChatMemory[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveAll(items: AgentChatMemory[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(memoryFile, JSON.stringify(items, null, 2), "utf8");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function getAgentChatMemory(eventId: string): Promise<RememberedRestaurant[]> {
  const items = await loadAll();
  return items.find((item) => item.eventId === eventId)?.restaurants ?? [];
}

export async function rememberAgentChatRestaurants(
  eventId: string,
  restaurants: RememberedRestaurant[],
): Promise<RememberedRestaurant[]> {
  const unique: RememberedRestaurant[] = [];
  for (const restaurant of restaurants) {
    const placeId = restaurant.placeId.trim();
    const name = restaurant.name.trim();
    if (!placeId || !name) {
      continue;
    }
    if (unique.some((item) => item.placeId === placeId)) {
      continue;
    }
    unique.push({ placeId, name });
  }
  if (unique.length === 0) {
    return getAgentChatMemory(eventId);
  }
  return enqueue(async () => {
    const items = await loadAll();
    const next: AgentChatMemory = {
      eventId,
      restaurants: unique.slice(0, 4),
      updatedAt: new Date().toISOString(),
    };
    const index = items.findIndex((item) => item.eventId === eventId);
    if (index < 0) {
      items.push(next);
    } else {
      items[index] = next;
    }
    await saveAll(items);
    return next.restaurants;
  });
}
