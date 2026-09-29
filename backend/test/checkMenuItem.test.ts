import { afterEach, describe, expect, it } from "vitest";
import { saveEvent } from "../src/events.ts";
import { saveRestaurantSearch } from "../src/restaurants.ts";
import { checkMenuItem, setMenuPageFetcher } from "../src/tools/checkMenuItem.ts";
import { clearMenuDetailsCache } from "../src/menuDetailsCache.ts";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { negotiateCouncilAgent } from "../src/workflows/negotiator.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

describe("check-menu-item tool", () => {
  const runtimes: TestRuntime[] = [];

  it("is available to the council app and negotiator agent", () => {
    const app = createCouncilApp({ models: {} });
    expect(app.tools?.some((tool) => tool.name === "check-menu-item")).toBe(true);
    expect(negotiateCouncilAgent.tools?.some((tool) => "name" in tool && tool.name === "check-menu-item")).toBe(true);
  });

  afterEach(async () => {
    setMenuPageFetcher(undefined);
    await clearMenuDetailsCache();
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("reports when a restaurant menu lists the item", async () => {
    setMenuPageFetcher(async (url) => {
      if (url.endsWith("/menu")) {
        return "Dinner Menu. Kids Mini Burger $8. House salad $11.";
      }
      return "Noodle Shop homepage.";
    });
    const { eventId, placeId } = await seedRestaurant();
    const result = await checkMenuItem.execute({
      eventId,
      placeId,
      item: "kids burger",
    });
    expect(result).toMatchObject({
      found: true,
      confidence: "confirmed",
      restaurantName: "Noodle Shop",
      item: "kids burger",
      sourceUrl: expect.stringMatching(/\/menu$/),
    });
    expect(result.excerpt?.toLowerCase()).toContain("burger");
  });

  it("does not treat a missing mention as a confirmed no", async () => {
    setMenuPageFetcher(async () => "Pad Thai $14. Spring rolls $7.");
    const { eventId, placeId } = await seedRestaurant();
    const result = await checkMenuItem.execute({
      eventId,
      placeId,
      item: "lobster roll",
    });
    expect(result.found).toBe(false);
    expect(result.confidence).toBe("unknown");
  });

  it("returns unknown when the restaurant has no website", async () => {
    const { eventId, placeId } = await seedRestaurant({ website: undefined });
    const result = await checkMenuItem.execute({
      eventId,
      placeId,
      item: "pad thai",
    });
    expect(result).toMatchObject({ found: false, confidence: "unknown", reason: "no_website" });
  });

  it("resolves Baoshi by a short name when checking a menu item", async () => {
    setMenuPageFetcher(async (url) => {
      if (url.includes("baoshi")) {
        return "French fries $9. Spring rolls $8.";
      }
      return "Home";
    });
    const { eventId } = await seedRestaurant({
      name: "Baoshi Food Hall + Bar",
      placeId: "ChIJY5VwE8ep2YgRNf_tSHXBmtU",
      website: "https://www.baoshifoodhall.com/",
    });
    const result = await checkMenuItem.execute({
      eventId,
      placeId: "baoshi",
      item: "french fries",
    });
    expect(result).toMatchObject({
      found: true,
      restaurantName: "Baoshi Food Hall + Bar",
      item: "french fries",
    });
  });

  it("rejects a restaurant that is not in the event search", async () => {
    const { eventId } = await seedRestaurant();
    await expect(
      checkMenuItem.execute({
        eventId,
        placeId: "missing-place",
        item: "pad thai",
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/not in this event/i), status: 404 });
  });

  it("checks a harvested menu URL before guessing /menu", async () => {
    setMenuPageFetcher(async (url) => {
      if (url.endsWith("/our-food")) {
        return "Dinner. Kids Mini Burger $8.";
      }
      return "Homepage with no dishes.";
    });
    const { eventId, placeId } = await seedRestaurant({
      website: "https://noodles.example",
      menuUrl: "https://noodles.example/our-food",
    });
    const result = await checkMenuItem.execute({
      eventId,
      placeId,
      item: "kids burger",
    });
    expect(result).toMatchObject({
      found: true,
      sourceUrl: "https://noodles.example/our-food",
    });
  });

  async function seedRestaurant(patch: { website?: string; name?: string; placeId?: string; menuUrl?: string } = {}) {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-menu-${crypto.randomUUID()}@example.com`,
      password: "secret123",
    });
    const eventId = crypto.randomUUID();
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
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
          website: "website" in patch && patch.website === undefined ? undefined : (patch.website ?? "https://noodles.example"),
          ...(patch.menuUrl ? { menuUrl: patch.menuUrl } : {}),
        },
      ],
    });
    return { eventId, placeId };
  }
});
