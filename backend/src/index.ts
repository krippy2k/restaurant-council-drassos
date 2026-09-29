import "dotenv/config";
import cors from "cors";
import express from "express";
import { requireAuth, signToken } from "./auth.js";
import { listContactsForOwner } from "./contacts.js";
import {
  applyCommandToEvent,
  applyFormPatch,
  commandFromEvent,
} from "./domain/commands.js";
import { getEventById, listEventsForUser, updateEvent } from "./events.js";
import {
  listInvitationsForEvent,
  listPendingInvitationsForUser,
  toInvitationView,
} from "./invitations.js";
import { listEventChat } from "./chat.js";
import { parseAgentChatRequest } from "./domain/agentChat.js";
import { eventChat } from "./tools/chat.js";
import { addConstraintVerification, getRestaurantsForEvent } from "./restaurants.js";
import { getCouncilProgress } from "./councilProgress.js";
import {
  isConstraintContactMethod,
  isConstraintVerificationResult,
} from "./domain/verifyConstraint.js";
import { listVisiblePreferences } from "./preferences.js";
import { isEventMember } from "./members.js";
import { attachReconvenedCouncil } from "./reconveneCouncil.js";
import {
  decideCreateEventWorkflow,
  getCreateEventSnapshot,
  getDrassos,
  interpretEventUpdate,
  runAddContactWorkflow,
  runAddEventPreferencesWorkflow,
  runStartCouncilWorkflow,
  runAgentChatRequestWorkflow,
  runDecideRestaurantWorkflow,
  decideInviteToEventWorkflow,
  startInviteToEventWorkflow,
  runLoginUserWorkflow,
  runLogoutUserWorkflow,
  runRegisterUserWorkflow,
  startCreateEventWorkflow,
  startDeleteEventWorkflow,
  stopDrassos,
} from "./drassos.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";

app.use(
  cors({
    origin: [frontendOrigin, "http://localhost:5173"],
  }),
);
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "restaurant-council" });
});

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body as {
      name?: string;
      email?: string;
      password?: string;
    };
    const user = await runRegisterUserWorkflow({
      name: String(name ?? ""),
      email: String(email ?? ""),
      password: String(password ?? ""),
    });
    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    const user = await runLoginUserWorkflow({
      email: String(email ?? ""),
      password: String(password ?? ""),
    });
    res.json({ token: signToken(user), user });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post("/api/logout", requireAuth, async (req, res) => {
  try {
    const tokenId = req.tokenId;
    if (!tokenId) {
      res.status(401).json({ error: "Session is no longer valid." });
      return;
    }
    const expiresAt = req.tokenExpiresAt
      ? new Date(req.tokenExpiresAt * 1000).toISOString()
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    res.json(
      await runLogoutUserWorkflow({
        userId: req.user!.id,
        tokenId,
        expiresAt,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/events", requireAuth, async (req, res) => {
  try {
    res.json({ events: await listEventsForUser(req.user!.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/contacts", requireAuth, async (req, res) => {
  try {
    res.json({ contacts: await listContactsForOwner(req.user!.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/contacts", requireAuth, async (req, res) => {
  try {
    const body = req.body as { name?: string; email?: string };
    const contact = await runAddContactWorkflow({
      ownerId: req.user!.id,
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
    });
    res.status(201).json({ contact });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/invitations", requireAuth, async (req, res) => {
  try {
    const pending = await listPendingInvitationsForUser(req.user!.id, req.user!.email);
    res.json({ invitations: await Promise.all(pending.map(toInvitationView)) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/invitations/:invitationId/respond", requireAuth, async (req, res) => {
  try {
    const body = req.body as { outcome?: string; reason?: string };
    const outcome = body.outcome === "rejected" ? "rejected" : body.outcome === "accepted" ? "accepted" : null;
    if (!outcome) {
      res.status(400).json({ error: "Choose accept or reject." });
      return;
    }
    const invitation = await decideInviteToEventWorkflow({
      invitationId: String(req.params.invitationId),
      userId: req.user!.id,
      outcome,
      reason: body.reason,
    });
    res.json({ invitation: await toInvitationView(invitation) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/events/:eventId", requireAuth, async (req, res) => {
  try {
    const event = await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    const preferences = await listVisiblePreferences(event.id, req.user!.id);
    res.json({ event, preferences });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/events/:eventId/preferences", requireAuth, async (req, res) => {
  try {
    await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    const message = String((req.body as { message?: string }).message ?? "").trim();
    if (!message) {
      res.status(400).json({ error: "Say a constraint or preference." });
      return;
    }
    await runAddEventPreferencesWorkflow({
      eventId: String(req.params.eventId),
      userId: req.user!.id,
      message,
    });
    res.status(201).json({
      preferences: await listVisiblePreferences(String(req.params.eventId), req.user!.id),
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/events/:eventId/chat", requireAuth, async (req, res) => {
  try {
    await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    res.json({ messages: await listEventChat(String(req.params.eventId), req.user!.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/events/:eventId/chat", requireAuth, async (req, res) => {
  try {
    await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    const eventId = String(req.params.eventId);
    const body = String((req.body as { message?: string }).message ?? "");
    await eventChat.execute({
      eventId,
      userId: req.user!.id,
      body,
      as: "user",
    });
    if (parseAgentChatRequest(body)) {
      try {
        await runAgentChatRequestWorkflow({
          eventId,
          userId: req.user!.id,
          message: body,
        });
      } catch (error) {
        console.error("agent-chat-request failed", error);
        await eventChat.execute({
          eventId,
          body: "I couldn't finish that request. You can try again.",
          as: "council",
        });
      }
    }
    res.status(201).json({ messages: await listEventChat(eventId, req.user!.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/events/:eventId/restaurants", requireAuth, async (req, res) => {
  try {
    await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    const search = await getRestaurantsForEvent(String(req.params.eventId));
    res.json({
      restaurants: search?.restaurants ?? [],
      searchedAt: search?.searchedAt ?? null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/events/:eventId/restaurants/:placeId/verify", requireAuth, async (req, res) => {
  try {
    await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    const body = req.body as { constraintId?: string; result?: string; method?: string; notes?: string };
    const result = String(body.result ?? "").trim();
    const method = String(body.method ?? "").trim();
    const constraintId = String(body.constraintId ?? "").trim();
    if (!constraintId) {
      throw Object.assign(new Error("Choose which constraint you verified."), { status: 400 });
    }
    if (!isConstraintVerificationResult(result)) {
      throw Object.assign(new Error("Choose whether the constraint was confirmed, not met, or still unknown."), {
        status: 400,
      });
    }
    if (!isConstraintContactMethod(method)) {
      throw Object.assign(new Error("Choose how you contacted the restaurant."), { status: 400 });
    }
    const restaurant = await addConstraintVerification({
      eventId: String(req.params.eventId),
      placeId: String(req.params.placeId),
      constraintId,
      result,
      method,
      notes: body.notes,
      userId: req.user!.id,
      userName: req.user!.name,
    });
    res.json(
      await attachReconvenedCouncil(
        String(req.params.eventId),
        req.user!.id,
        { restaurant },
        runStartCouncilWorkflow,
      ),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/events/:eventId/restaurants/:placeId/decide", requireAuth, async (req, res) => {
  try {
    await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    const decision = String((req.body as { decision?: string }).decision ?? "").trim();
    const restaurant = await runDecideRestaurantWorkflow({
      eventId: String(req.params.eventId),
      placeId: String(req.params.placeId),
      userId: req.user!.id,
      decision,
    });
    res.json(
      await attachReconvenedCouncil(
        String(req.params.eventId),
        req.user!.id,
        { restaurant },
        runStartCouncilWorkflow,
      ),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/events/:eventId/council/progress", requireAuth, async (req, res) => {
  try {
    await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    const progress = await getCouncilProgress(String(req.params.eventId));
    res.json({ progress });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/events/:eventId/council", requireAuth, async (req, res) => {
  try {
    await requireEventAccess(String(req.params.eventId), req.user!.id, req.user!.email);
    const result = await runStartCouncilWorkflow({
      eventId: String(req.params.eventId),
      userId: req.user!.id,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/events/:eventId/invitations", requireAuth, async (req, res) => {
  try {
    await requireOwnedEvent(String(req.params.eventId), req.user!.id);
    const invitations = await listInvitationsForEvent(String(req.params.eventId));
    res.json({ invitations: await Promise.all(invitations.map(toInvitationView)) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/events/:eventId/invite", requireAuth, async (req, res) => {
  try {
    await requireOwnedEvent(String(req.params.eventId), req.user!.id);
    const body = req.body as { email?: string; contactId?: string; contactName?: string };
    const invitation = await startInviteToEventWorkflow({
      eventId: String(req.params.eventId),
      ownerId: req.user!.id,
      email: body.email,
      contactId: body.contactId,
      contactName: body.contactName,
    });
    res.status(201).json({ invitation: await toInvitationView(invitation) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/events/:eventId/delete", requireAuth, async (req, res) => {
  try {
    await requireOwnedEvent(String(req.params.eventId), req.user!.id);
    res.json(
      await startDeleteEventWorkflow({
        eventId: String(req.params.eventId),
        ownerId: req.user!.id,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.patch("/api/events/:eventId", requireAuth, async (req, res) => {
  try {
    const current = await requireOwnedEvent(String(req.params.eventId), req.user!.id);
    const body = req.body as {
      name?: string;
      date?: string;
      time?: string;
      locationLabel?: string;
      radiusMiles?: number;
      kidFriendly?: boolean;
      timezone?: string;
    };
    const event = await updateEvent(
      applyFormPatch(current, body, new Date().toISOString(), body.timezone?.trim() || current.timezone || "America/New_York"),
    );
    res.json({ event });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/events/:eventId/interpret", requireAuth, async (req, res) => {
  try {
    const current = await requireOwnedEvent(String(req.params.eventId), req.user!.id);
    const message = String((req.body as { message?: string }).message ?? "").trim();
    const timezone =
      String((req.body as { timezone?: string }).timezone ?? "").trim() || current.timezone || "America/New_York";
    if (!message) {
      res.status(400).json({ error: "Describe the change you want." });
      return;
    }
    const command = await interpretEventUpdate({
      message,
      timezone,
      previousCommand: commandFromEvent(current, timezone),
    });
    const event = await updateEvent(applyCommandToEvent(current, command, new Date().toISOString()));
    res.json({ event });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/workflow", requireAuth, async (req, res) => {
  try {
    const message = String((req.body as { message?: string }).message ?? "").trim();
    const timezone = String((req.body as { timezone?: string }).timezone ?? "").trim() || "America/New_York";
    if (!message) {
      res.status(400).json({ error: "Write a message before submitting." });
      return;
    }
    const snapshot = await startCreateEventWorkflow({
      message,
      ownerId: req.user!.id,
      timezone,
    });
    res.json(snapshot);
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/workflow/:runId", requireAuth, async (req, res) => {
  try {
    res.json(await getCreateEventSnapshot(String(req.params.runId), req.user!.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/workflow/:runId/decision", requireAuth, async (req, res) => {
  try {
    const body = req.body as { outcome?: string; feedback?: string; reason?: string };
    if (body.outcome === "approved") {
      res.json(await decideCreateEventWorkflow(String(req.params.runId), req.user!.id, { outcome: "approved" }));
      return;
    }
    if (body.outcome === "changes_requested") {
      const feedback = String(body.feedback ?? "").trim();
      if (!feedback) {
        res.status(400).json({ error: "Describe the change you want." });
        return;
      }
      res.json(
        await decideCreateEventWorkflow(String(req.params.runId), req.user!.id, {
          outcome: "changes_requested",
          feedback,
        }),
      );
      return;
    }
    if (body.outcome === "rejected") {
      res.json(
        await decideCreateEventWorkflow(String(req.params.runId), req.user!.id, {
          outcome: "rejected",
          reason: String(body.reason ?? "").trim() || undefined,
        }),
      );
      return;
    }
    res.status(400).json({ error: "Choose approve, request changes, or reject." });
  } catch (error) {
    sendError(res, error);
  }
});

app.listen(port, () => {
  console.log(`Restaurant Council API on http://127.0.0.1:${port}`);
  void getDrassos().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
});

process.once("SIGINT", () => {
  void stopDrassos().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void stopDrassos().finally(() => process.exit(0));
});

function sendError(res: express.Response, error: unknown): void {
  const status = Number((error as { status?: number }).status ?? 500);
  const message = error instanceof Error ? error.message : "Unexpected error.";
  res.status(status).json({ error: message });
}

async function requireOwnedEvent(eventId: string, ownerId: string) {
  const event = await getEventById(eventId);
  if (!event) {
    throw Object.assign(new Error("Event was not found."), { status: 404 });
  }
  if (event.ownerId !== ownerId) {
    throw Object.assign(new Error("That event belongs to another host."), { status: 403 });
  }
  return event;
}

async function requireEventAccess(eventId: string, userId: string, email: string) {
  const event = await getEventById(eventId);
  if (!event) {
    throw Object.assign(new Error("Event was not found."), { status: 404 });
  }
  if (event.ownerId === userId) {
    return event;
  }
  if (await isEventMember(eventId, userId)) {
    return event;
  }
  const pending = await listPendingInvitationsForUser(userId, email);
  if (pending.some((item) => item.eventId === eventId)) {
    return event;
  }
  throw Object.assign(new Error("That event belongs to another host."), { status: 403 });
}

