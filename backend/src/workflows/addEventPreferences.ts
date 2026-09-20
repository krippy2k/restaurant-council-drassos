import { defineAgent, workflow } from "@drassos/core";
import { draftsFromAgentOutput, normalizePreferenceDrafts, preferenceDraftSchema, type PreferenceDraft } from "../domain/preferences.js";
import type { Preference } from "../domain/types.js";
import { getEventById } from "../events.js";
import { listPendingInvitationsForUser } from "../invitations.js";
import { isEventMember } from "../members.js";
import { saveEventPreferences } from "../preferences.js";
import { getUserById } from "../users.js";

export type AddEventPreferencesInput = {
  eventId: string;
  userId: string;
  message: string;
};

export type AddEventPreferencesOutput = {
  preferences: Preference[];
};

export const interpretPreferencesAgent = defineAgent({
  name: "interpret-preferences",
  model: "openai:gpt-4o-mini",
  instructions: [
    "You record dining constraints and preferences for one person at a restaurant event.",
    "Return JSON with a constraints array. Each item has category, label, priority, visibility, and optional value.",
    "Categories: cuisine, price, dietary, allergies, accessibility, distance, atmosphere, seating, dislikes, favorites, freeform.",
    "Cannot eat gluten, celiac, or gluten-free is category dietary, label Gluten free, value.type gluten-free, priority HARD.",
    "A meal below a dollar amount is category price, label Under $N, value.maxDollars N, priority HARD.",
    "Must, need, cannot, required, have to, and hard limits are priority HARD.",
    "Prefer or nice to have is HIGH or MEDIUM, not HARD.",
    "visibility is PUBLIC unless the person asks to keep it private, keep it quiet, confidential, secret, or not tell others — then PRIVATE on that same constraint.",
    "Always include the dining constraint itself in constraints. A privacy request is not a reason to return an empty list.",
    "Do not invent constraints that are not in the message.",
  ].join(" "),
  output: preferenceDraftSchema,
  limits: {
    maxTurns: 4,
    timeout: "60s",
  },
});

export const addEventPreferencesWorkflow = workflow<AddEventPreferencesInput, AddEventPreferencesOutput>(
  "add-event-preferences",
  async (ctx) => {
    const message = String(ctx.input.message ?? "").trim();
    if (!message) {
      throw Object.assign(new Error("Say a constraint or preference."), { status: 400 });
    }

    await ctx.step("load-event", async () => {
      const event = await getEventById(ctx.input.eventId);
      if (!event) {
        throw Object.assign(new Error("Event was not found."), { status: 404 });
      }
      const user = await getUserById(ctx.input.userId);
      if (!user) {
        throw Object.assign(new Error("User was not found."), { status: 404 });
      }
      if (event.ownerId === user.id || (await isEventMember(event.id, user.id))) {
        return event;
      }
      const pending = await listPendingInvitationsForUser(user.id, user.email);
      if (pending.some((item) => item.eventId === event.id)) {
        return event;
      }
      throw Object.assign(new Error("That event belongs to another host."), { status: 403 });
    });

    const draft = await ctx.agent.run<PreferenceDraft>(interpretPreferencesAgent, {
      input: { message },
    });

    const preferences = await ctx.step("save-preferences", async () => {
      const normalized = normalizePreferenceDrafts(draftsFromAgentOutput(draft, message), {
        id: () => ctx.uuid(),
        eventId: ctx.input.eventId,
        userId: ctx.input.userId,
        nowIso: ctx.now().toISOString(),
      });
      return saveEventPreferences(normalized);
    });

    return { preferences };
  },
);
