import { afterEach, describe, expect, it } from "vitest";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { saveEvent } from "../src/events.ts";
import { getRestaurantsForEvent, saveRestaurantSearch } from "../src/restaurants.ts";
import { clearPlaceDetailsCache, setPlaceHoursLoader } from "../src/places.ts";
import { lookupRestaurantHours } from "../src/tools/lookupRestaurantHours.ts";
import { negotiateCouncilAgent } from "../src/workflows/negotiator.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

describe("lookup-restaurant-hours tool", () => {
  const runtimes: TestRuntime[] = [];

  it("is available to the council app and negotiator agent", () => {
    const app = createCouncilApp({ models: {} });
    expect(app.tools?.some((tool) => tool.name === "lookup-restaurant-hours")).toBe(true);
    expect(
      negotiateCouncilAgent.tools?.some((tool) => "name" in tool && tool.name === "lookup-restaurant-hours"),
    ).toBe(true);
  });

  afterEach(async () => {
    setPlaceHoursLoader(undefined);
    await clearPlaceDetailsCache();
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("returns stored hours without calling Place Details", async () => {
    let detailCalls = 0;
    setPlaceHoursLoader(async () => {
      detailCalls += 1;
      return { hours: ["Monday: Closed"] };
    });
    const weekly = ["Monday: 11:00 AM – 9:00 PM", "Friday: 5:00 PM – 10:00 PM"];
    const { eventId, placeId } = await seedRestaurant({
      hours: weekly,
      openNow: false,
      date: "2026-09-25",
    });
    const result = await lookupRestaurantHours.execute({ eventId, placeId });
    expect(detailCalls).toBe(0);
    expect(result).toMatchObject({
      restaurantName: "Noodle Shop",
      placeId,
      hours: weekly,
      hoursForDay: "Friday: 5:00 PM – 10:00 PM",
      openNow: false,
      source: "event",
    });
  });

  it("maps next Saturday to the Saturday hours line", async () => {
    const weekly = ["Friday: 11:30 AM – 1:00 AM", "Saturday: 11:30 AM – 1:00 AM"];
    const { eventId } = await seedRestaurant({
      hours: weekly,
      name: "Baoshi Food Hall + Bar",
      placeId: "ChIJY5VwE8ep2YgRNf_tSHXBmtU",
    });
    const result = await lookupRestaurantHours.execute({
      eventId,
      placeId: "baoshi",
      weekday: "What are the hours for baoshi next Saturday?",
    });
    expect(result).toMatchObject({
      found: true,
      restaurantName: "Baoshi Food Hall + Bar",
      hoursForDay: "Saturday: 11:30 AM – 1:00 AM",
      source: "event",
    });
  });

  it("resolves a restaurant by name when placeId is a shortened Cooper's Hawk query", async () => {
    const weekly = ["Monday: 11:00 AM – 9:00 PM", "Friday: 11:00 AM – 10:00 PM"];
    const { eventId } = await seedRestaurant({
      hours: weekly,
      name: "Cooper’s Hawk Winery & Restaurant",
      placeId: "ChIJjS1x3ASm2YgRmI_a_Wp8Mqc",
    });
    const result = await lookupRestaurantHours.execute({
      eventId,
      placeId: "Cooper's Hawk",
    });
    expect(result).toMatchObject({
      found: true,
      restaurantName: "Cooper’s Hawk Winery & Restaurant",
      hours: weekly,
      source: "event",
    });
  });

  it("loads hours from Place Details when the event restaurant has none", async () => {
    const weekly = ["Saturday: 10:00 AM – 2:00 PM"];
    setPlaceHoursLoader(async () => ({ hours: weekly, openNow: true }));
    const { eventId, placeId } = await seedRestaurant();
    const result = await lookupRestaurantHours.execute({
      eventId,
      placeId,
      weekday: "Saturday",
    });
    expect(result).toMatchObject({
      found: true,
      hours: weekly,
      hoursForDay: "Saturday: 10:00 AM – 2:00 PM",
      openNow: true,
      source: "places",
    });
    const saved = await getRestaurantsForEvent(eventId);
    expect(saved?.restaurants[0]?.hours).toEqual(weekly);
  });

  it("returns unknown when hours are not published", async () => {
    setPlaceHoursLoader(async () => ({}));
    const { eventId, placeId } = await seedRestaurant();
    const result = await lookupRestaurantHours.execute({ eventId, placeId });
    expect(result).toMatchObject({ found: false, hours: [], source: "unknown", reason: "unknown_hours" });
  });

  it("rejects a restaurant that is not in the event search", async () => {
    const { eventId } = await seedRestaurant();
    await expect(
      lookupRestaurantHours.execute({
        eventId,
        placeId: "missing-place",
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/not in this event/i), status: 404 });
  });

  async function seedRestaurant(
    patch: { hours?: string[]; openNow?: boolean; date?: string; name?: string; placeId?: string } = {},
  ) {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-hours-${crypto.randomUUID()}@example.com`,
      password: "secret123",
    });
    const eventId = crypto.randomUUID();
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
      date: patch.date,
      status: "draft",
      createdAt: "",
      updatedAt: "",
    });
    const placeId = patch.placeId ?? "noodles";
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId,
          name: patch.name ?? "Noodle Shop",
          matched: true,
          hours: patch.hours,
          openNow: patch.openNow,
        },
      ],
    });
    return { eventId, placeId };
  }
});
