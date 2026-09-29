import type { PlaceHoursAndPhoto } from "./places.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CachedPlaceDetails = {
  placeId: string;
  fetchedAt: number;
  details: PlaceHoursAndPhoto;
};

export const PLACE_DETAILS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const cacheFile = path.join(dataDir, "place-details.json");

let ttlMs = PLACE_DETAILS_CACHE_TTL_MS;
let writeQueue: Promise<void> = Promise.resolve();

export function setPlaceDetailsCacheTtlMs(next: number | undefined): void {
  ttlMs = next === undefined ? PLACE_DETAILS_CACHE_TTL_MS : next;
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function loadAll(): Promise<CachedPlaceDetails[]> {
  try {
    const raw = await readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw) as CachedPlaceDetails[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function stillFresh(entry: CachedPlaceDetails, now: number): boolean {
  return now - entry.fetchedAt < ttlMs;
}

export function normalizePlaceId(placeId: string): string {
  return placeId.replace(/^places\//, "");
}

export async function getCachedPlaceDetails(
  placeId: string,
  now = Date.now(),
): Promise<PlaceHoursAndPhoto | null> {
  const id = normalizePlaceId(placeId);
  const items = await loadAll();
  const entry = items.find((item) => item.placeId === id);
  if (!entry || !stillFresh(entry, now)) {
    return null;
  }
  return entry.details;
}

export async function putCachedPlaceDetails(
  placeId: string,
  details: PlaceHoursAndPhoto,
  now = Date.now(),
): Promise<void> {
  const id = normalizePlaceId(placeId);
  await enqueue(async () => {
    const items = await loadAll();
    const record: CachedPlaceDetails = { placeId: id, fetchedAt: now, details };
    const index = items.findIndex((item) => item.placeId === id);
    if (index < 0) {
      items.push(record);
    } else {
      items[index] = record;
    }
    await mkdir(dataDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(items, null, 2), "utf8");
  });
}

export async function clearPlaceDetailsCache(): Promise<void> {
  await enqueue(async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(cacheFile, "[]", "utf8");
  });
}
