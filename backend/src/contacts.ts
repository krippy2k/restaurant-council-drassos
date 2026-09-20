import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Contact } from "./domain/types.js";
import { getUserByEmail } from "./users.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const contactsFile = path.join(dataDir, "contacts.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadContacts(): Promise<Contact[]> {
  try {
    const raw = await readFile(contactsFile, "utf8");
    const parsed = JSON.parse(raw) as Contact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveContacts(contacts: Contact[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(contactsFile, JSON.stringify(contacts, null, 2), "utf8");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function listContactsForOwner(ownerId: string): Promise<Contact[]> {
  const contacts = await loadContacts();
  return contacts
    .filter((item) => item.ownerId === ownerId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getContactById(id: string, ownerId: string): Promise<Contact | null> {
  const contacts = await loadContacts();
  return contacts.find((item) => item.id === id && item.ownerId === ownerId) ?? null;
}

export async function findContactByName(ownerId: string, name: string): Promise<Contact> {
  const needle = name.trim().toLowerCase();
  const matches = (await listContactsForOwner(ownerId)).filter((item) => item.name.trim().toLowerCase() === needle);
  if (matches.length === 0) {
    throw Object.assign(new Error("No contact has that name."), { status: 404 });
  }
  if (matches.length > 1) {
    throw Object.assign(new Error("More than one contact has that name. Invite by email instead."), { status: 409 });
  }
  return matches[0]!;
}

export async function addContact(input: {
  id: string;
  ownerId: string;
  name: string;
  email: string;
  createdAt: string;
}): Promise<Contact> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) {
    throw Object.assign(new Error("Name must be at least 2 characters."), { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  }
  const existingUser = await getUserByEmail(email);
  return enqueue(async () => {
    const contacts = await loadContacts();
    if (contacts.some((item) => item.ownerId === input.ownerId && item.email === email)) {
      throw Object.assign(new Error("That email is already in your contacts."), { status: 409 });
    }
    const contact: Contact = {
      id: input.id,
      ownerId: input.ownerId,
      name,
      email,
      userId: existingUser?.id ?? null,
      createdAt: input.createdAt,
    };
    contacts.push(contact);
    await saveContacts(contacts);
    return contact;
  });
}
