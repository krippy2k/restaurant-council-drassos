import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RevokedToken = {
  tokenId: string;
  userId: string;
  expiresAt: string;
  revokedAt: string;
};

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const revokedFile = path.join(dataDir, "revoked-tokens.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadRevoked(): Promise<RevokedToken[]> {
  try {
    const raw = await readFile(revokedFile, "utf8");
    const parsed = JSON.parse(raw) as RevokedToken[];
    const now = Date.now();
    return Array.isArray(parsed)
      ? parsed.filter((item) => Date.parse(item.expiresAt) > now)
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveRevoked(tokens: RevokedToken[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(revokedFile, JSON.stringify(tokens, null, 2), "utf8");
}

export async function isTokenRevoked(tokenId: string): Promise<boolean> {
  const tokens = await loadRevoked();
  return tokens.some((item) => item.tokenId === tokenId);
}

export async function revokeToken(input: {
  tokenId: string;
  userId: string;
  expiresAt: string;
  revokedAt?: string;
}): Promise<{ loggedOut: true; tokenId: string; userId: string }> {
  const tokenId = input.tokenId.trim();
  const userId = input.userId.trim();
  if (!tokenId || !userId) {
    throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  }

  await enqueue(async () => {
    const tokens = await loadRevoked();
    if (!tokens.some((item) => item.tokenId === tokenId)) {
      tokens.push({
        tokenId,
        userId,
        expiresAt: input.expiresAt,
        revokedAt: input.revokedAt ?? new Date().toISOString(),
      });
      await saveRevoked(tokens);
    }
  });

  return { loggedOut: true, tokenId, userId };
}

function enqueue(work: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
