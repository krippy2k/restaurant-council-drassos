import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventMember } from "./domain/types.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const membersFile = path.join(dataDir, "members.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadMembers(): Promise<EventMember[]> {
  try {
    const raw = await readFile(membersFile, "utf8");
    const parsed = JSON.parse(raw) as EventMember[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveMembers(members: EventMember[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(membersFile, JSON.stringify(members, null, 2), "utf8");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function listJoinedEventIds(userId: string): Promise<string[]> {
  const members = await loadMembers();
  return members.filter((item) => item.userId === userId && item.status === "joined").map((item) => item.eventId);
}

export async function isEventMember(eventId: string, userId: string): Promise<boolean> {
  const members = await loadMembers();
  return members.some((item) => item.eventId === eventId && item.userId === userId && item.status === "joined");
}

export async function listJoinedMembers(eventId: string): Promise<EventMember[]> {
  const members = await loadMembers();
  return members.filter((item) => item.eventId === eventId && item.status === "joined");
}

export async function addJoinedMember(input: {
  eventId: string;
  userId: string;
  joinedAt: string;
}): Promise<EventMember> {
  return enqueue(async () => {
    const members = await loadMembers();
    const existing = members.find((item) => item.eventId === input.eventId && item.userId === input.userId);
    if (existing) {
      existing.status = "joined";
      existing.joinedAt = input.joinedAt;
      await saveMembers(members);
      return existing;
    }
    const member: EventMember = {
      eventId: input.eventId,
      userId: input.userId,
      role: "member",
      status: "joined",
      joinedAt: input.joinedAt,
    };
    members.push(member);
    await saveMembers(members);
    return member;
  });
}
