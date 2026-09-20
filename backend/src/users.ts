import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import type { PublicUser, StoredUser } from "./types.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const usersFile = path.join(dataDir, "users.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadUsers(): Promise<StoredUser[]> {
  try {
    const raw = await readFile(usersFile, "utf8");
    const parsed = JSON.parse(raw) as StoredUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveUsers(users: StoredUser[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(usersFile, JSON.stringify(users, null, 2), "utf8");
}

function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    pendingInvitationIds: user.pendingInvitationIds ?? [],
  };
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
  id?: string;
  createdAt?: string;
}): Promise<PublicUser> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (name.length < 2) {
    throw Object.assign(new Error("Name must be at least 2 characters."), { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  }
  if (password.length < 8) {
    throw Object.assign(new Error("Password must be at least 8 characters."), { status: 400 });
  }

  const created = await enqueue(async () => {
    const users = await loadUsers();
    if (users.some((user) => user.email === email)) {
      throw Object.assign(new Error("An account with that email already exists."), { status: 409 });
    }

    const user: StoredUser = {
      id: input.id ?? crypto.randomUUID(),
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: input.createdAt ?? new Date().toISOString(),
      pendingInvitationIds: [],
    };
    users.push(user);
    await saveUsers(users);
    return user;
  });

  return toPublicUser(created);
}

export async function authenticateUser(email: string, password: string): Promise<PublicUser> {
  const users = await loadUsers();
  const user = users.find((entry) => entry.email === email.trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw Object.assign(new Error("Invalid email or password."), { status: 401 });
  }
  return toPublicUser(user);
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const users = await loadUsers();
  const user = users.find((entry) => entry.id === id);
  return user ? toPublicUser(user) : null;
}

export async function getUserByEmail(email: string): Promise<PublicUser | null> {
  const users = await loadUsers();
  const user = users.find((entry) => entry.email === email.trim().toLowerCase());
  return user ? toPublicUser(user) : null;
}

export async function addPendingInvitation(userId: string, invitationId: string): Promise<void> {
  await enqueue(async () => {
    const users = await loadUsers();
    const user = users.find((entry) => entry.id === userId);
    if (!user) {
      throw Object.assign(new Error("User was not found."), { status: 404 });
    }
    const ids = user.pendingInvitationIds ?? [];
    if (!ids.includes(invitationId)) {
      user.pendingInvitationIds = [...ids, invitationId];
      await saveUsers(users);
    }
  });
}

export async function removePendingInvitation(userId: string, invitationId: string): Promise<void> {
  await enqueue(async () => {
    const users = await loadUsers();
    const user = users.find((entry) => entry.id === userId);
    if (!user) {
      return;
    }
    user.pendingInvitationIds = (user.pendingInvitationIds ?? []).filter((id) => id !== invitationId);
    await saveUsers(users);
  });
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
