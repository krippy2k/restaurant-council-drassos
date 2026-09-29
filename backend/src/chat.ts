import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventChatMessage } from "./domain/types.js";
import { getUserById } from "./users.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const chatFile = path.join(dataDir, "event-chat.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadMessages(): Promise<EventChatMessage[]> {
  try {
    const raw = await readFile(chatFile, "utf8");
    const parsed = JSON.parse(raw) as EventChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveMessages(messages: EventChatMessage[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(chatFile, JSON.stringify(messages, null, 2), "utf8");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export type EventChatMessageView = EventChatMessage & {
  userName: string;
  mine: boolean;
};

export const COUNCIL_CHAT_USER_ID = "council";

async function toView(message: EventChatMessage, viewerId: string): Promise<EventChatMessageView> {
  if (message.userId === COUNCIL_CHAT_USER_ID) {
    return {
      ...message,
      userName: "The Council",
      mine: false,
    };
  }
  const user = await getUserById(message.userId);
  return {
    ...message,
    userName: user?.name ?? "Guest",
    mine: message.userId === viewerId,
  };
}

export async function listEventChat(eventId: string, viewerId: string): Promise<EventChatMessageView[]> {
  const messages = (await loadMessages())
    .filter((item) => item.eventId === eventId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return Promise.all(messages.map((item) => toView(item, viewerId)));
}

export async function addEventChatMessage(input: {
  id: string;
  eventId: string;
  userId: string;
  body: string;
  createdAt: string;
}): Promise<EventChatMessage> {
  const body = input.body.trim();
  if (!body) {
    throw Object.assign(new Error("Write a message before submitting."), { status: 400 });
  }
  if (body.length > 2000) {
    throw Object.assign(new Error("That message is too long."), { status: 400 });
  }
  return enqueue(async () => {
    const messages = await loadMessages();
    const next: EventChatMessage = { ...input, body };
    messages.push(next);
    await saveMessages(messages);
    return next;
  });
}

export async function addCouncilChatMessage(input: {
  eventId: string;
  body: string;
  createdAt?: string;
}): Promise<EventChatMessage> {
  return addEventChatMessage({
    id: crypto.randomUUID(),
    eventId: input.eventId,
    userId: COUNCIL_CHAT_USER_ID,
    body: input.body,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}
