import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CouncilRunProgress = {
  eventId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  agent: string;
  tool: string;
  updatedAt: string;
  error?: string;
};

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const progressFile = path.join(dataDir, "council-progress.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadAll(): Promise<CouncilRunProgress[]> {
  try {
    const raw = await readFile(progressFile, "utf8");
    const parsed = JSON.parse(raw) as CouncilRunProgress[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function getCouncilProgress(eventId: string): Promise<CouncilRunProgress | null> {
  const items = await loadAll();
  return items.find((item) => item.eventId === eventId) ?? null;
}

export async function setCouncilProgress(
  next: Omit<CouncilRunProgress, "updatedAt"> & { updatedAt?: string },
): Promise<CouncilRunProgress> {
  const record: CouncilRunProgress = {
    ...next,
    updatedAt: next.updatedAt ?? new Date().toISOString(),
  };
  return enqueue(async () => {
    const items = await loadAll();
    const index = items.findIndex((item) => item.eventId === record.eventId);
    if (index < 0) {
      items.push(record);
    } else {
      items[index] = record;
    }
    await mkdir(dataDir, { recursive: true });
    await writeFile(progressFile, JSON.stringify(items, null, 2), "utf8");
    return record;
  });
}
