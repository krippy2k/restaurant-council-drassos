import { workflow } from "@drassos/core";
import {
  applyNegotiatorPicks,
  candidatesForNegotiator,
  constraintsForNegotiator,
  type NegotiationDraft,
} from "../domain/negotiate.js";
import { attachDietaryAssessments } from "../dietaryLookup.js";
import { attachUserScores, hardConstraintsForEvent, keepMatchingRestaurants, type CouncilParticipant, type CouncilRestaurant } from "../domain/matchRestaurants.js";
import { getEventById } from "../events.js";
import { listPendingInvitationsForUser } from "../invitations.js";
import { isEventMember, listJoinedMembers } from "../members.js";
import { loadHoursAndPhotos, searchNearbyRestaurants } from "../places.js";
import { listEventPreferences } from "../preferences.js";
import { getRestaurantsForEvent, saveRestaurantSearch } from "../restaurants.js";
import { setCouncilProgress } from "../councilProgress.js";
import { getUserById } from "../users.js";
import { mergeRestaurantVerifications } from "../domain/verifyConstraint.js";
import { negotiateCouncilAgent } from "./negotiator.js";

export type StartCouncilInput = {
  eventId: string;
  userId: string;
};

export type StartCouncilOutput = {
  restaurants: CouncilRestaurant[];
  searchedAt: string;
};

export const startCouncilWorkflow = workflow<StartCouncilInput, StartCouncilOutput>("start-council", async (ctx) => {
  const eventId = ctx.input.eventId;
  await report(eventId, "Council Clerk", "Load event");
  await ctx.step("clear-results", async () =>
    saveRestaurantSearch({
      eventId,
      searchedAt: ctx.now().toISOString(),
      restaurants: [],
    }),
  );
  const event = await ctx.step("load-event", async () => {
    const found = await getEventById(ctx.input.eventId);
    if (!found) {
      throw Object.assign(new Error("Event was not found."), { status: 404 });
    }
    const user = await getUserById(ctx.input.userId);
    if (!user) {
      throw Object.assign(new Error("User was not found."), { status: 404 });
    }
    if (found.ownerId === user.id || (await isEventMember(found.id, user.id))) {
      return found;
    }
    const pending = await listPendingInvitationsForUser(user.id, user.email);
    if (pending.some((item) => item.eventId === found.id)) {
      return found;
    }
    throw Object.assign(new Error("That event belongs to another host."), { status: 403 });
  });

  const area = event.searchArea;
  const locationLabel = area?.displayName?.trim() || event.locationLabel?.trim();
  if (!locationLabel || !area) {
    throw Object.assign(new Error("This event needs a search area before Council can start."), { status: 400 });
  }

  await report(eventId, "Scout", "Restaurant search");
  const places = await ctx.step("search-places", async () =>
    searchNearbyRestaurants({
      ...area,
      displayName: locationLabel,
    }),
  );
  await report(eventId, "Council Clerk", "Load constraints");
  const preferences = await ctx.step("load-constraints", async () => listEventPreferences(event.id));
  await report(eventId, "Personal Agents", "Filter mismatches");
  const matched = await ctx.step("filter-restaurants", async () =>
    keepMatchingRestaurants(places, hardConstraintsForEvent(event, preferences)),
  );
  await report(eventId, "Scout", "Restaurant hours and photos");
  const withHours = await ctx.step("load-hours", async () => loadHoursAndPhotos(matched));
  await report(eventId, "Dietary Analyzer", "Menus, website, and reviews");
  const withDietary = await ctx.step("lookup-dietary", async () => attachDietaryAssessments(withHours, preferences));
  await report(eventId, "Personal Agents", "Score restaurants");
  const scored = await ctx.step("score-restaurants", async () => {
    const participants = await listEventParticipants(event.id, event.ownerId, preferences.map((item) => item.userId));
    return attachUserScores(
      withDietary.map((restaurant) => ({ ...restaurant, matched: true as const })),
      participants,
      preferences,
      event,
    );
  });
  let restaurants = applyNegotiatorPicks(scored, { picks: [], scores: [] });
  if (scored.length > 0) {
    await report(eventId, "Negotiator", "Language model");
    try {
      const draft = await ctx.agent.run<NegotiationDraft>(negotiateCouncilAgent, {
        input: JSON.parse(
          JSON.stringify({
            constraints: constraintsForNegotiator(preferences),
            candidates: candidatesForNegotiator(scored),
          }),
        ),
      });
      restaurants = applyNegotiatorPicks(scored, {
        picks: draft.picks ?? [],
        scores: draft.scores ?? [],
      });
    } catch {
      restaurants = applyNegotiatorPicks(scored, { picks: [], scores: [] });
    }
  }
  await report(eventId, "Council Clerk", "Save results");
  const searchedAt = ctx.now().toISOString();
  const previous = await getRestaurantsForEvent(event.id);
  restaurants = mergeRestaurantVerifications(restaurants, previous?.restaurants ?? []);
  await ctx.step("save-results", async () =>
    saveRestaurantSearch({
      eventId: event.id,
      searchedAt,
      restaurants,
    }),
  );
  await setCouncilProgress({ eventId, status: "COMPLETED", agent: "Negotiator", tool: "Done" });
  return { restaurants, searchedAt };
});

async function listEventParticipants(
  eventId: string,
  ownerId: string,
  preferenceUserIds: string[],
): Promise<CouncilParticipant[]> {
  const members = await listJoinedMembers(eventId);
  const ids = [...new Set([ownerId, ...members.map((item) => item.userId), ...preferenceUserIds])];
  const participants: CouncilParticipant[] = [];
  for (const id of ids) {
    const user = await getUserById(id);
    if (user) {
      participants.push({ id: user.id, name: user.name });
    }
  }
  return participants;
}

async function report(eventId: string, agent: string, tool: string): Promise<void> {
  await setCouncilProgress({ eventId, status: "RUNNING", agent, tool });
}
