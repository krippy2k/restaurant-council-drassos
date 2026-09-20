import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthTokenPayload, PublicUser } from "./types.js";
import { isTokenRevoked } from "./sessions.js";
import { getUserById } from "./users.js";

const jwtSecret = process.env.JWT_SECRET ?? "change-me-in-development";

export function signToken(user: PublicUser): string {
  return jwt.sign({ sub: user.id, email: user.email } satisfies AuthTokenPayload, jwtSecret, {
    expiresIn: "7d",
    jwtid: crypto.randomUUID(),
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as AuthTokenPayload;
    if (payload.jti && (await isTokenRevoked(payload.jti))) {
      res.status(401).json({ error: "Session is no longer valid." });
      return;
    }
    const user = await getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: "Session is no longer valid." });
      return;
    }
    req.user = user;
    req.tokenId = payload.jti;
    req.tokenExpiresAt = payload.exp;
    next();
  } catch {
    res.status(401).json({ error: "Session is no longer valid." });
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
      tokenId?: string;
      tokenExpiresAt?: number;
    }
  }
}
