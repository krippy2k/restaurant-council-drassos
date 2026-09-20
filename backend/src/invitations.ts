import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Invitation } from "./domain/types.js";
import { getEventById } from "./events.js";
import { addPendingInvitation, getUserByEmail, getUserById, removePendingInvitation } from "./users.js";

type EmailInviteFlag = {
  email: string;
  invitationIds: string[];
};

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const invitationsFile = path.join(dataDir, "invitations.json");
const flagsFile = path.join(dataDir, "invite-flags.json");

let writeQueue: Promise<void> = Promise.resolve();

async function readJson<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function getInvitationById(id: string): Promise<Invitation | null> {
  const invitations = await readJson<Invitation>(invitationsFile);
  return invitations.find((item) => item.id === id) ?? null;
}

export async function listInvitationsForEvent(eventId: string): Promise<Invitation[]> {
  const invitations = await readJson<Invitation>(invitationsFile);
  return invitations.filter((item) => item.eventId === eventId);
}

export async function listPendingInvitationsForUser(userId: string, email: string): Promise<Invitation[]> {
  const invitations = await readJson<Invitation>(invitationsFile);
  const normalized = email.trim().toLowerCase();
  return invitations.filter(
    (item) =>
      item.status === "pending" &&
      (item.userId === userId || item.email === normalized),
  );
}

export async function createInvitation(input: {
  id: string;
  eventId: string;
  invitedBy: string;
  email: string;
  createdAt: string;
  workflowRunId?: string;
}): Promise<Invitation> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  }

  const invitee = await getUserByEmail(email);
  const inviter = await getUserById(input.invitedBy);
  if (inviter && inviter.email === email) {
    throw Object.assign(new Error("You cannot invite yourself."), { status: 400 });
  }

  const invitation = await enqueue(async () => {
    const invitations = await readJson<Invitation>(invitationsFile);
    const duplicate = invitations.find(
      (item) => item.eventId === input.eventId && item.email === email && item.status === "pending",
    );
    if (duplicate) {
      throw Object.assign(new Error("That person already has a pending invite to this event."), { status: 409 });
    }
    const next: Invitation = {
      id: input.id,
      eventId: input.eventId,
      invitedBy: input.invitedBy,
      email,
      userId: invitee?.id ?? null,
      status: "pending",
      createdAt: input.createdAt,
      workflowRunId: input.workflowRunId,
    };
    invitations.push(next);
    await writeJson(invitationsFile, invitations);

    if (!invitee) {
      const flags = await readJson<EmailInviteFlag>(flagsFile);
      const flag = flags.find((item) => item.email === email);
      if (flag) {
        if (!flag.invitationIds.includes(next.id)) {
          flag.invitationIds.push(next.id);
        }
      } else {
        flags.push({ email, invitationIds: [next.id] });
      }
      await writeJson(flagsFile, flags);
    }
    return next;
  });

  if (invitee) {
    await addPendingInvitation(invitee.id, invitation.id);
  }
  return invitation;
}

export async function claimInvitationsForUser(user: { id: string; email: string }): Promise<Invitation[]> {
  const email = user.email.trim().toLowerCase();
  const claimed = await enqueue(async () => {
    const invitations = await readJson<Invitation>(invitationsFile);
    const matched = invitations.filter((item) => item.email === email && item.status === "pending");
    for (const item of matched) {
      item.userId = user.id;
    }
    await writeJson(invitationsFile, invitations);

    const flags = await readJson<EmailInviteFlag>(flagsFile);
    const remaining = flags.filter((item) => item.email !== email);
    await writeJson(flagsFile, remaining);
    return matched;
  });

  for (const item of claimed) {
    await addPendingInvitation(user.id, item.id);
  }
  return claimed;
}

export async function respondToInvitation(input: {
  invitationId: string;
  userId: string;
  email: string;
  outcome: "accepted" | "rejected";
  reason?: string;
  respondedAt: string;
}): Promise<Invitation> {
  const invitation = await getInvitationById(input.invitationId);
  if (!invitation) {
    throw Object.assign(new Error("Invitation was not found."), { status: 404 });
  }
  if (invitation.status !== "pending") {
    throw Object.assign(new Error("That invitation was already answered."), { status: 409 });
  }
  const email = input.email.trim().toLowerCase();
  if (invitation.userId !== input.userId && invitation.email !== email) {
    throw Object.assign(new Error("That invitation is not for you."), { status: 403 });
  }
  if (input.outcome === "rejected" && !String(input.reason ?? "").trim()) {
    throw Object.assign(new Error("Say why you are declining."), { status: 400 });
  }

  const updated = await enqueue(async () => {
    const invitations = await readJson<Invitation>(invitationsFile);
    const current = invitations.find((item) => item.id === input.invitationId);
    if (!current) {
      throw Object.assign(new Error("Invitation was not found."), { status: 404 });
    }
    current.status = input.outcome;
    current.userId = input.userId;
    current.respondedAt = input.respondedAt;
    if (input.outcome === "rejected") {
      current.rejectReason = String(input.reason ?? "").trim();
    }
    await writeJson(invitationsFile, invitations);
    return current;
  });

  await removePendingInvitation(input.userId, updated.id);
  return updated;
}

export async function toInvitationView(invitation: Invitation) {
  const [event, host] = await Promise.all([getEventById(invitation.eventId), getUserById(invitation.invitedBy)]);
  return {
    ...invitation,
    eventName: event?.name ?? "Event",
    eventDate: event?.date,
    hostName: host?.name ?? "Host",
  };
}
