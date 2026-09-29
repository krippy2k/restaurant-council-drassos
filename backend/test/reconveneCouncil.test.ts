import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { attachReconvenedCouncil } from "../src/reconveneCouncil.ts";
import { setCouncilProgress } from "../src/councilProgress.ts";
import { saveEvent } from "../src/events.ts";
import { setNearbyRestaurantSearch, setPlaceHoursLoader } from "../src/places.ts";
import { addConstraintVerification, saveRestaurantSearch } from "../src/restaurants.ts";
import { decideRestaurantWorkflow } from "../src/workflows/decideRestaurant.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";
import { startCouncilWorkflow } from "../src/workflows/startCouncil.ts";

describe("auto-reconvene council", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    setNearbyRestaurantSearch(undefined);
    setPlaceHoursLoader(undefined);
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("searches restaurants again after an approve", async () => {
    let searches = 0;
    setNearbyRestaurantSearch(async () => {
      searches += 1;
      return [{ placeId: "cheap", name: "Noodle Shop", priceLevel: "PRICE_LEVEL_INEXPENSIVE" }];
    });
    setPlaceHoursLoader(async () => ({}));
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const { eventId, userId, restaurant } = await seedEvent(runtime);

    const decided = await runtime.execute(decideRestaurantWorkflow, {
      eventId,
      placeId: restaurant.placeId,
      userId,
      decision: "approve",
    });
    const attached = await attachReconvenedCouncil(
      eventId,
      userId,
      { restaurant: decided.output!.restaurant },
      async (input) => {
        const result = await runtime.execute(startCouncilWorkflow, input);
        if (result.status !== "COMPLETED" || result.output == null) {
          throw new Error(result.error?.message ?? "Council failed");
        }
        return result.output;
      },
    );

    expect(searches).toBeGreaterThanOrEqual(1);
    expect(attached.restaurants).toEqual(expect.any(Array));
    expect(attached.searchedAt).toEqual(expect.any(String));
    expect(attached.restaurant.placeId).toBe(restaurant.placeId);
  });

  it("searches restaurants again after a constraint confirmation", async () => {
    let searches = 0;
    setNearbyRestaurantSearch(async () => {
      searches += 1;
      return [{ placeId: "cheap", name: "Noodle Shop", priceLevel: "PRICE_LEVEL_INEXPENSIVE" }];
    });
    setPlaceHoursLoader(async () => ({}));
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const { eventId, userId, restaurant } = await seedEvent(runtime, true);

    const verified = await addConstraintVerification({
      eventId,
      placeId: restaurant.placeId,
      constraintId: "kid",
      result: "meets",
      method: "phone",
      userId,
      userName: "Ada Chen",
    });
    const attached = await attachReconvenedCouncil(eventId, userId, { restaurant: verified }, async (input) => {
      const result = await runtime.execute(startCouncilWorkflow, input);
      if (result.status !== "COMPLETED" || result.output == null) {
        throw new Error(result.error?.message ?? "Council failed");
      }
      return result.output;
    });

    expect(searches).toBeGreaterThanOrEqual(1);
    expect(attached.restaurants).toEqual(expect.any(Array));
  });

  it("does not start a second council while one is already running", async () => {
    const startCouncil = vi.fn();
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const { eventId, userId, restaurant } = await seedEvent(runtime);
    await setCouncilProgress({ eventId, status: "RUNNING", agent: "Scout", tool: "Restaurant search" });

    const attached = await attachReconvenedCouncil(eventId, userId, { restaurant }, startCouncil);

    expect(startCouncil).not.toHaveBeenCalled();
    expect(attached.restaurants).toBeUndefined();
  });
});

async function seedEvent(runtime: TestRuntime, withConstraint = false) {
  const host = await runtime.execute(registerUserWorkflow, {
    name: "Ada Chen",
    email: `ada-reconvene-${crypto.randomUUID()}@example.com`,
    password: "secret123",
  });
  const userId = host.output!.user.id;
  const eventId = crypto.randomUUID();
  await saveEvent({
    id: eventId,
    ownerId: userId,
    name: "Friday dinner",
    status: "draft",
    locationLabel: "Cambridge",
    searchArea: {
      displayName: "Cambridge",
      latitude: 42.37,
      longitude: -71.11,
      radiusMeters: 8000,
      source: "address",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const restaurant = {
    placeId: "cheap",
    name: "Noodle Shop",
    matched: true as const,
    userScores: [{ userId, userName: "Ada Chen", score: 70 }],
    constraintChecks: withConstraint ? [{ id: "kid", label: "Kid friendly", confirmed: false }] : undefined,
  };
  await saveRestaurantSearch({
    eventId,
    searchedAt: new Date().toISOString(),
    restaurants: [restaurant],
  });
  return { eventId, userId, restaurant };
}
