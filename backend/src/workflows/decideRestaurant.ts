import { workflow } from "@drassos/core";
import type { CouncilRestaurant } from "../domain/matchRestaurants.js";
import {
  councilDecisionChat,
  isRestaurantDecision,
  labelsForUserConstraints,
  type RestaurantDecisionKind,
} from "../domain/restaurantDecision.js";
import { getEventById } from "../events.js";
import { listPendingInvitationsForUser } from "../invitations.js";
import { isEventMember } from "../members.js";
import { listEventPreferences } from "../preferences.js";
import { saveRestaurantDecision } from "../restaurants.js";
import { eventChat } from "../tools/chat.js";
import { getUserById } from "../users.js";

export type DecideRestaurantInput = {
  eventId: string;
  placeId: string;
  userId: string;
  decision: RestaurantDecisionKind | string;
};

export type DecideRestaurantOutput = {
  restaurant: CouncilRestaurant;
};

export const decideRestaurantWorkflow = workflow<DecideRestaurantInput, DecideRestaurantOutput>(
  "decide-restaurant",
  async (ctx) => {
    const decision = String(ctx.input.decision ?? "").trim();
    if (!isRestaurantDecision(decision)) {
      throw Object.assign(new Error("Choose Approve, Reject, Prefer, or Dislike."), { status: 400 });
    }
    const placeId = String(ctx.input.placeId ?? "").trim();
    if (!placeId) {
      throw Object.assign(new Error("Choose a restaurant."), { status: 400 });
    }

    const user = await ctx.step("authorize", async () => {
      const event = await getEventById(ctx.input.eventId);
      if (!event) {
        throw Object.assign(new Error("Event was not found."), { status: 404 });
      }
      const found = await getUserById(ctx.input.userId);
      if (!found) {
        throw Object.assign(new Error("User was not found."), { status: 404 });
      }
      if (event.ownerId === found.id || (await isEventMember(event.id, found.id))) {
        return found;
      }
      const pending = await listPendingInvitationsForUser(found.id, found.email);
      if (pending.some((item) => item.eventId === event.id)) {
        return found;
      }
      throw Object.assign(new Error("That event belongs to another host."), { status: 403 });
    });

    const userConstraintLabels = await ctx.step("load-constraints", async () => {
      const preferences = await listEventPreferences(ctx.input.eventId);
      return labelsForUserConstraints(preferences, user.id);
    });

    const restaurant = await ctx.step("apply-decision", async () =>
      saveRestaurantDecision({
        eventId: ctx.input.eventId,
        placeId,
        userId: user.id,
        userName: user.name,
        decision,
        nowIso: ctx.now().toISOString(),
        userConstraintLabels,
      }),
    );

    await ctx.tool(eventChat).run({
      eventId: ctx.input.eventId,
      body: councilDecisionChat({
        userName: user.name,
        restaurantName: restaurant.name,
        decision,
      }),
      as: "council",
      createdAt: ctx.now().toISOString(),
    });

    return { restaurant };
  },
);
