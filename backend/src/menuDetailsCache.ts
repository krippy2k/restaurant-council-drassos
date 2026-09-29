import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MENU_DETAILS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const cacheFile = path.join(dataDir, "menu-details.json");

export type CachedMenuPlace = {
  placeId: string;
  fetchedAt: number;
  website: string;
  menuUrl?: string;
};

export type CachedMenuPage = {
  url: string;
  fetchedAt: number;
  text: string;
};

type MenuCacheFile = {
  places: CachedMenuPlace[];
  pages: CachedMenuPage[];
};

let ttlMs = MENU_DETAILS_CACHE_TTL_MS;
let writeQueue: Promise<void> = Promise.resolve();

export function setMenuDetailsCacheTtlMs(next: number | undefined): void {
  ttlMs = next === undefined ? MENU_DETAILS_CACHE_TTL_MS : next;
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function stillFresh(fetchedAt: number, now: number): boolean {
  return now - fetchedAt < ttlMs;
}

async function loadAll(): Promise<MenuCacheFile> {
  try {
    const raw = await readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw) as MenuCacheFile;
    return {
      places: Array.isArray(parsed.places) ? parsed.places : [],
      pages: Array.isArray(parsed.pages) ? parsed.pages : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { places: [], pages: [] };
    }
    throw error;
  }
}

async function saveAll(next: MenuCacheFile): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(next, null, 2), "utf8");
}

export function normalizePlaceId(placeId: string): string {
  return placeId.replace(/^places\//, "");
}

export async function getCachedMenuPlace(
  placeId: string,
  website: string,
  now = Date.now(),
): Promise<CachedMenuPlace | null> {
  const id = normalizePlaceId(placeId);
  const site = website.trim();
  const items = await loadAll();
  const entry = items.places.find((item) => item.placeId === id);
  if (!entry || entry.website !== site || !stillFresh(entry.fetchedAt, now)) {
    return null;
  }
  return entry;
}

export async function putCachedMenuPlace(
  placeId: string,
  website: string,
  menuUrl: string | undefined,
  now = Date.now(),
): Promise<void> {
  const id = normalizePlaceId(placeId);
  const site = website.trim();
  if (!site) {
    return;
  }
  await enqueue(async () => {
    const items = await loadAll();
    const record: CachedMenuPlace = { placeId: id, fetchedAt: now, website: site, menuUrl };
    const index = items.places.findIndex((item) => item.placeId === id);
    if (index < 0) {
      items.places.push(record);
    } else {
      items.places[index] = record;
    }
    await saveAll(items);
  });
}

export async function getCachedMenuPage(url: string, now = Date.now()): Promise<string | null> {
  const items = await loadAll();
  const entry = items.pages.find((item) => item.url === url);
  if (!entry || !stillFresh(entry.fetchedAt, now)) {
    return null;
  }
  return entry.text;
}

export async function putCachedMenuPage(url: string, text: string, now = Date.now()): Promise<void> {
  const trimmed = text.trim();
  if (!url.trim() || !trimmed) {
    return;
  }
  await enqueue(async () => {
    const items = await loadAll();
    const record: CachedMenuPage = { url, fetchedAt: now, text: trimmed };
    const index = items.pages.findIndex((item) => item.url === url);
    if (index < 0) {
      items.pages.push(record);
    } else {
      items.pages[index] = record;
    }
    await saveAll(items);
  });
}

export async function rememberMenuDetails<T extends { placeId: string; website?: string; menuUrl?: string }>(
  restaurants: T[],
): Promise<void> {
  for (const restaurant of restaurants) {
    const website = restaurant.website?.trim();
    if (!website) {
      continue;
    }
    await putCachedMenuPlace(restaurant.placeId, website, restaurant.menuUrl?.trim() || undefined);
  }
}

export async function readCachedMenuPageOrFetch(
  url: string,
  fetchText: (url: string) => Promise<string | null>,
): Promise<string | null> {
  const cached = await getCachedMenuPage(url);
  if (cached) {
    return cached;
  }
  const text = await fetchText(url);
  if (text) {
    await putCachedMenuPage(url, text);
  }
  return text;
}

export async function clearMenuDetailsCache(): Promise<void> {
  await enqueue(async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify({ places: [], pages: [] }, null, 2), "utf8");
  });
}
