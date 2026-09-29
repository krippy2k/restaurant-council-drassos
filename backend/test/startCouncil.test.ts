import { afterEach, describe, expect, it } from "vitest";
import { ScriptedModelProvider } from "@drassos/node";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { constraintChecksForPlace, constraintFlagsForPlace, keepMatchingRestaurants, scorePlaceForUser } from "../src/domain/matchRestaurants.ts";
import { saveEvent } from "../src/events.ts";
import { isRestaurantPlace, setNearbyRestaurantSearch, setPlaceHoursLoader } from "../src/places.ts";
import { setDietaryLookup } from "../src/dietaryLookup.ts";
import { setWebsiteHtmlFetcher } from "../src/menuDiscovery.ts";
import { clearMenuDetailsCache } from "../src/menuDetailsCache.ts";
import { findMenuLinksAgent } from "../src/workflows/findMenuLinks.ts";
import { saveEventPreferences } from "../src/preferences.ts";
import { getRestaurantsForEvent, saveRestaurantSearch } from "../src/restaurants.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";
import { startCouncilWorkflow } from "../src/workflows/startCouncil.ts";

describe("restaurant constraint matching", () => {
  it("keeps only restaurant place types", () => {
    expect(isRestaurantPlace({ primaryType: "mexican_restaurant" })).toBe(true);
    expect(isRestaurantPlace({ types: ["restaurant", "food"] })).toBe(true);
    expect(isRestaurantPlace({ primaryType: "park", types: ["park", "point_of_interest"] })).toBe(false);
    expect(isRestaurantPlace({ primaryType: "cafe", types: ["cafe", "food"] })).toBe(false);
  });

  it("drops a restaurant only when a required constraint is confirmed", () => {
    const kept = keepMatchingRestaurants(
      [
        { placeId: "cheap", name: "Noodle Shop", priceLevel: "PRICE_LEVEL_INEXPENSIVE" },
        { placeId: "fancy", name: "Steak House", priceLevel: "PRICE_LEVEL_EXPENSIVE" },
        { placeId: "unknown", name: "Cafe", priceLevel: undefined, goodForChildren: null },
      ],
      [{ id: "price", label: "Under $30", publicLabel: "Under $30", kind: "price", maxDollars: 30 }],
    );
    expect(kept.map((item) => item.placeId)).toEqual(["cheap", "unknown"]);
  });

  it("scores a restaurant per user from their preferences", () => {
    const tacoPlace = {
      placeId: "tacos",
      name: "Taco Stand",
      types: ["mexican_restaurant", "restaurant"],
      priceLevel: "PRICE_LEVEL_INEXPENSIVE",
      servesVegetarianFood: true,
    };
    const steakPlace = {
      placeId: "steak",
      name: "Steak House",
      types: ["steak_house", "restaurant"],
      priceLevel: "PRICE_LEVEL_EXPENSIVE",
      servesVegetarianFood: false,
    };
    const ada = [
      {
        id: "p1",
        eventId: "e1",
        userId: "ada",
        category: "price" as const,
        visibility: "PUBLIC" as const,
        priority: "HARD" as const,
        value: { label: "Under $30", maxDollars: 30 },
        createdAt: "",
        updatedAt: "",
      },
    ];
    const bob = [
      {
        id: "p2",
        eventId: "e1",
        userId: "bob",
        category: "cuisine" as const,
        visibility: "PUBLIC" as const,
        priority: "HIGH" as const,
        value: { label: "Mexican", type: "mexican" },
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(scorePlaceForUser(tacoPlace, ada)).toBe(100);
    expect(scorePlaceForUser(tacoPlace, bob)).toBe(100);
    expect(scorePlaceForUser(steakPlace, bob)).toBe(0);
    expect(scorePlaceForUser(tacoPlace, [])).toBe(100);
  });

  it("flags constraints that miss or cannot be confirmed", () => {
    const flags = constraintFlagsForPlace(
      {
        placeId: "steak",
        name: "Steak House",
        types: ["steak_house", "restaurant"],
        goodForChildren: null,
      },
      [
        {
          id: "p2",
          eventId: "e1",
          userId: "bob",
          category: "cuisine",
          visibility: "PUBLIC",
          priority: "HIGH",
          value: { label: "Mexican", type: "mexican" },
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "p3",
          eventId: "e1",
          userId: "ada",
          category: "dietary",
          visibility: "PRIVATE",
          priority: "HARD",
          value: { label: "Peanut allergy", type: "peanut" },
          createdAt: "",
          updatedAt: "",
        },
      ],
      {
        id: "e1",
        ownerId: "ada",
        name: "Dinner",
        status: "draft",
        constraints: [{ type: "kid-friendly", label: "Kid Friendly", strength: "required" }],
        createdAt: "",
        updatedAt: "",
      },
    );
    expect(flags).toEqual([
      { id: "p2", label: "Mexican", status: "mismatch" },
      { id: "p3", label: "A private constraint", status: "uncertain" },
    ]);
  });

  it("lists hard public constraints and how they were confirmed", () => {
    const checks = constraintChecksForPlace(
      {
        placeId: "noodles",
        name: "Noodle Shop",
        priceLevel: "PRICE_LEVEL_INEXPENSIVE",
        dietaryAssessments: [
          {
            restaurantId: "noodles",
            requirement: "gluten-free",
            status: "confirmed",
            confidence: 0.9,
            evidence: [
              {
                id: "evd",
                sourceType: "official-menu",
                excerpt: "Gluten-free dishes are marked on the menu.",
                supports: "supports",
                reliability: "high",
              },
            ],
          },
        ],
      },
      [
        {
          id: "p1",
          eventId: "e1",
          userId: "ada",
          category: "dietary",
          visibility: "PUBLIC",
          priority: "HARD",
          value: { label: "Gluten free", type: "gluten-free" },
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "p2",
          eventId: "e1",
          userId: "bob",
          category: "price",
          visibility: "PUBLIC",
          priority: "HARD",
          value: { label: "Under $30", maxDollars: 30 },
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "p3",
          eventId: "e1",
          userId: "ada",
          category: "dietary",
          visibility: "PRIVATE",
          priority: "HARD",
          value: { label: "Peanut allergy", type: "peanut" },
          createdAt: "",
          updatedAt: "",
        },
      ],
      {
        id: "e1",
        ownerId: "ada",
        name: "Dinner",
        status: "draft",
        constraints: [{ type: "kid-friendly", label: "Kid Friendly", strength: "required" }],
        createdAt: "",
        updatedAt: "",
      },
    );
    expect(checks).toEqual([
      { id: "event:kid-friendly", label: "Kid Friendly", confirmed: false },
      { id: "p1", label: "Gluten free", confirmed: true, confirmation: "Confirmed by the menu" },
      { id: "p2", label: "Under $30", confirmed: true, confirmation: "Confirmed by listed price level" },
    ]);
  });
});

describe("start-council workflow", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    setNearbyRestaurantSearch(undefined);
    setPlaceHoursLoader(undefined);
    setDietaryLookup(undefined);
    setWebsiteHtmlFetcher(undefined);
    await clearMenuDetailsCache();
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("searches nearby restaurants and removes confirmed mismatches", async () => {
    setNearbyRestaurantSearch(async () => [
      { placeId: "cheap", name: "Noodle Shop", priceLevel: "PRICE_LEVEL_INEXPENSIVE" },
      { placeId: "fancy", name: "Steak House", priceLevel: "PRICE_LEVEL_EXPENSIVE" },
    ]);
    setPlaceHoursLoader(async (placeId) => ({
      photoUrl: `https://photos.test/${placeId}.jpg`,
      hours: ["Monday: 11:00 AM – 9:00 PM", "Tuesday: Closed"],
      openNow: true,
    }));
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: host.output!.user.id,
      name: "Friday dinner",
      status: "draft",
      searchArea: {
        displayName: "Bamford Park",
        latitude: 26.1,
        longitude: -80.2,
        radiusMeters: 8000,
        source: "address",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveEventPreferences([
      {
        id: crypto.randomUUID(),
        eventId: event.id,
        userId: host.output!.user.id,
        category: "price",
        visibility: "PUBLIC",
        priority: "HARD",
        value: { label: "Under $30", maxDollars: 30 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const result = await runtime.execute(startCouncilWorkflow, {
      eventId: event.id,
      userId: host.output!.user.id,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.restaurants.map((item) => item.placeId)).toEqual(["cheap"]);
    expect(result.output?.restaurants[0]).toMatchObject({
      photoUrl: "https://photos.test/cheap.jpg",
      hours: ["Monday: 11:00 AM – 9:00 PM", "Tuesday: Closed"],
      openNow: true,
      picked: true,
      councilScore: 100,
      userScores: [{ userId: host.output!.user.id, userName: "Ada Chen", score: 100 }],
    });
    expect(result.output?.restaurants[0]?.explanations).toContain("Within everyone's hard constraints");
    expect((await getRestaurantsForEvent(event.id))?.restaurants.map((item) => item.placeId)).toEqual(["cheap"]);
  }, 20_000);

  it("lets the negotiator rank restaurants without leaking private reasons", async () => {
    setNearbyRestaurantSearch(async () => [
      { placeId: "cheap", name: "Noodle Shop", priceLevel: "PRICE_LEVEL_INEXPENSIVE" },
      { placeId: "tacos", name: "Taco Stand", priceLevel: "PRICE_LEVEL_INEXPENSIVE", types: ["mexican_restaurant"] },
    ]);
    setPlaceHoursLoader(async () => ({
      hours: ["Friday: 5:00 PM – 10:00 PM"],
    }));
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: new ScriptedModelProvider(
            [
              {
                output: {
                  scores: [
                    { placeId: "tacos", score: 80 },
                    { placeId: "cheap", score: 70 },
                  ],
                },
              },
              {
                output: {
                  picks: [
                    {
                      candidateId: "tacos",
                      score: 91,
                      explanations: ["Outdoor seating available", "Ada can't afford this"],
                    },
                  ],
                  scores: [{ candidateId: "cheap", score: 74 }],
                },
              },
            ],
            "openai",
          ),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: host.output!.user.id,
      name: "Friday dinner",
      status: "draft",
      searchArea: {
        displayName: "Bamford Park",
        latitude: 26.1,
        longitude: -80.2,
        radiusMeters: 8000,
        source: "address",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await runtime.execute(startCouncilWorkflow, {
      eventId: event.id,
      userId: host.output!.user.id,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.restaurants.map((item) => item.placeId)).toEqual(["tacos", "cheap"]);
    expect(result.output?.restaurants[0]?.picked).toBe(true);
    expect(result.output?.restaurants[0]?.councilScore).toBe(91);
    expect(result.output?.restaurants[0]?.explanations).toContain("Outdoor seating available");
    expect(result.output?.restaurants[0]?.explanations?.some((line) => /afford/i.test(line))).toBe(false);
    expect(result.output?.restaurants[1]).toMatchObject({ picked: false, councilScore: 74 });
  }, 20_000);

  it("keeps an approval in personal scores when Council runs again", async () => {
    setNearbyRestaurantSearch(async () => [
      { placeId: "cheap", name: "Noodle Shop", priceLevel: "PRICE_LEVEL_INEXPENSIVE" },
    ]);
    setPlaceHoursLoader(async () => ({ hours: ["Friday: 5:00 PM – 10:00 PM"] }));
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: host.output!.user.id,
      name: "Friday dinner",
      status: "draft",
      searchArea: {
        displayName: "Bamford Park",
        latitude: 26.1,
        longitude: -80.2,
        radiusMeters: 8000,
        source: "address",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveEventPreferences([
      {
        id: crypto.randomUUID(),
        eventId: event.id,
        userId: host.output!.user.id,
        category: "cuisine",
        visibility: "PUBLIC",
        priority: "HIGH",
        value: { label: "Mexican", type: "mexican" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    await saveRestaurantSearch({
      eventId: event.id,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId: "cheap",
          name: "Noodle Shop",
          matched: true,
          userScores: [{ userId: host.output!.user.id, userName: "Ada Chen", score: 100, decision: "approve" }],
          decisions: [
            {
              userId: host.output!.user.id,
              userName: "Ada Chen",
              decision: "approve",
              baseScore: 70,
              at: new Date().toISOString(),
            },
          ],
        },
      ],
    });
    const result = await runtime.execute(startCouncilWorkflow, {
      eventId: event.id,
      userId: host.output!.user.id,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.restaurants[0]?.userScores?.[0]).toMatchObject({
      userId: host.output!.user.id,
      score: 100,
      decision: "approve",
    });
    expect(result.output?.restaurants[0]?.decisions?.[0]?.decision).toBe("approve");
  }, 20_000);

  it("is registered on the council app", () => {
    const app = createCouncilApp({ models: {} });
    expect(app.agents?.some((agent) => agent.name === "find-menu-links")).toBe(true);
    expect(app.agents?.some((agent) => agent.name === "personal-agent")).toBe(true);
    expect(findMenuLinksAgent.name).toBe("find-menu-links");
  });

  it("stores a menu URL harvested from homepage links without a model", async () => {
    setWebsiteHtmlFetcher(async () => `<a href="/about">About</a><a href="/dinner-menu">Dinner Menu</a>`);
    setNearbyRestaurantSearch(async () => [
      {
        placeId: "cheap",
        name: "Noodle Shop",
        priceLevel: "PRICE_LEVEL_INEXPENSIVE",
        website: "https://noodles.example",
      },
    ]);
    setPlaceHoursLoader(async () => ({ hours: ["Friday: 5:00 PM – 10:00 PM"] }));
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: host.output!.user.id,
      name: "Friday dinner",
      status: "draft",
      searchArea: {
        displayName: "Bamford Park",
        latitude: 26.1,
        longitude: -80.2,
        radiusMeters: 8000,
        source: "address",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = await runtime.execute(startCouncilWorkflow, {
      eventId: event.id,
      userId: host.output!.user.id,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.restaurants[0]?.menuUrl).toBe("https://noodles.example/dinner-menu");
  }, 20_000);

  it("lets the menu scout agent pick a harvested link that heuristics miss", async () => {
    setWebsiteHtmlFetcher(async () => `<a href="/hours">Hours</a><a href="/our-food">View the card</a>`);
    setNearbyRestaurantSearch(async () => [
      {
        placeId: "cheap",
        name: "Noodle Shop",
        priceLevel: "PRICE_LEVEL_INEXPENSIVE",
        website: "https://noodles.example",
      },
    ]);
    setPlaceHoursLoader(async () => ({ hours: ["Friday: 5:00 PM – 10:00 PM"] }));
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: new ScriptedModelProvider(
            [
              {
                output: {
                  menus: [{ placeId: "cheap", menuUrl: "https://noodles.example/our-food" }],
                },
              },
            ],
            "openai",
          ),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: host.output!.user.id,
      name: "Friday dinner",
      status: "draft",
      searchArea: {
        displayName: "Bamford Park",
        latitude: 26.1,
        longitude: -80.2,
        radiusMeters: 8000,
        source: "address",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = await runtime.execute(startCouncilWorkflow, {
      eventId: event.id,
      userId: host.output!.user.id,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.restaurants[0]?.menuUrl).toBe("https://noodles.example/our-food");
  }, 20_000);

  it("runs one personal agent per user and keeps each person's preferences private to that run", async () => {
    setNearbyRestaurantSearch(async () => [
      { placeId: "tacos", name: "Taco Stand", priceLevel: "PRICE_LEVEL_INEXPENSIVE", types: ["mexican_restaurant"] },
      { placeId: "noodles", name: "Noodle Shop", priceLevel: "PRICE_LEVEL_INEXPENSIVE", types: ["noodle_restaurant"] },
    ]);
    setPlaceHoursLoader(async () => ({ hours: ["Friday: 5:00 PM – 10:00 PM"] }));
    const seen: unknown[] = [];
    const scripted = new ScriptedModelProvider(
      [
        {
          output: {
            scores: [
              { placeId: "tacos", score: 92 },
              { placeId: "noodles", score: 15 },
            ],
          },
        },
        {
          output: {
            scores: [
              { placeId: "tacos", score: 20 },
              { placeId: "noodles", score: 81 },
            ],
          },
        },
      ],
      "openai",
    );
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: {
            name: "openai",
            generate: async (request) => {
              for (const message of request.messages) {
                if (message.role === "user" && message.content) {
                  seen.push(JSON.parse(message.content));
                }
              }
              return scripted.generate(request);
            },
          },
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const guest = await runtime.execute(registerUserWorkflow, {
      name: "Bob Lee",
      email: `guest-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const adaId = host.output!.user.id;
    const bobId = guest.output!.user.id;
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: adaId,
      name: "Friday dinner",
      status: "draft",
      searchArea: {
        displayName: "Bamford Park",
        latitude: 26.1,
        longitude: -80.2,
        radiusMeters: 8000,
        source: "address",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveEventPreferences([
      {
        id: crypto.randomUUID(),
        eventId: event.id,
        userId: adaId,
        category: "cuisine",
        visibility: "PUBLIC",
        priority: "HIGH",
        value: { label: "Mexican", type: "mexican" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        eventId: event.id,
        userId: bobId,
        category: "dietary",
        visibility: "PRIVATE",
        priority: "HARD",
        value: { label: "Peanut allergy", type: "peanut" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const result = await runtime.execute(startCouncilWorkflow, {
      eventId: event.id,
      userId: adaId,
    });

    expect(result.status).toBe("COMPLETED");
    const events = await runtime.history(result.runId);
    expect(
      events
        .filter((event) => event.type === "agent.completed")
        .map((event) => (event.payload as { name?: string }).name)
        .filter((name) => name?.startsWith("personal-agent-")),
    ).toEqual([`personal-agent-${adaId}`, `personal-agent-${bobId}`]);
    const personalInputs = seen.filter(
      (input): input is { user?: { id?: string }; preferences?: unknown[] } =>
        Boolean(input && typeof input === "object" && "user" in input),
    );
    expect(personalInputs.map((input) => input.user?.id)).toEqual([adaId, bobId]);
    expect(JSON.stringify(personalInputs[0])).toContain("Mexican");
    expect(JSON.stringify(personalInputs[0])).not.toContain("Peanut");
    expect(JSON.stringify(personalInputs[1])).toContain("Peanut allergy");
    expect(JSON.stringify(personalInputs[1])).not.toContain("Mexican");
    const tacos = result.output?.restaurants.find((item) => item.placeId === "tacos");
    const noodles = result.output?.restaurants.find((item) => item.placeId === "noodles");
    expect(tacos?.userScores).toEqual([
      { userId: adaId, userName: "Ada Chen", score: 92 },
      { userId: bobId, userName: "Bob Lee", score: 20 },
    ]);
    expect(noodles?.userScores).toEqual([
      { userId: adaId, userName: "Ada Chen", score: 15 },
      { userId: bobId, userName: "Bob Lee", score: 81 },
    ]);
  }, 20_000);
});
