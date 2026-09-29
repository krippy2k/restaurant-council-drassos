import { afterEach, describe, expect, it } from "vitest";
import {
  clearMenuDetailsCache,
  MENU_DETAILS_CACHE_TTL_MS,
  setMenuDetailsCacheTtlMs,
} from "../src/menuDetailsCache.ts";
import { harvestMenuLinks, setWebsiteHtmlFetcher } from "../src/menuDiscovery.ts";
import { checkMenuItem, setMenuPageFetcher } from "../src/tools/checkMenuItem.ts";
import { saveEvent } from "../src/events.ts";
import { saveRestaurantSearch } from "../src/restaurants.ts";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

describe("menu details cache", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    setWebsiteHtmlFetcher(undefined);
    setMenuPageFetcher(undefined);
    setMenuDetailsCacheTtlMs(undefined);
    await clearMenuDetailsCache();
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("keeps menu details for seven days by default", () => {
    expect(MENU_DETAILS_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("reuses a harvested menu URL instead of fetching the homepage again", async () => {
    let htmlCalls = 0;
    setWebsiteHtmlFetcher(async () => {
      htmlCalls += 1;
      return `<nav><a href="/dinner-menu">Dinner Menu</a></nav>`;
    });
    const first = await harvestMenuLinks([
      { placeId: "noodles", name: "Noodle Shop", website: "https://noodles.example" },
    ]);
    const second = await harvestMenuLinks([
      { placeId: "noodles", name: "Noodle Shop", website: "https://noodles.example" },
    ]);
    expect(htmlCalls).toBe(1);
    expect(first.restaurants[0]?.menuUrl).toBe("https://noodles.example/dinner-menu");
    expect(second.restaurants[0]?.menuUrl).toBe("https://noodles.example/dinner-menu");
    expect(second.agentInput.restaurants).toEqual([]);
  });

  it("looks up the homepage again after the menu cache expires", async () => {
    let htmlCalls = 0;
    setWebsiteHtmlFetcher(async () => {
      htmlCalls += 1;
      return `<nav><a href="/menu-${htmlCalls}">Dinner Menu</a></nav>`;
    });
    setMenuDetailsCacheTtlMs(1);
    await harvestMenuLinks([{ placeId: "noodles", name: "Noodle Shop", website: "https://noodles.example" }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await harvestMenuLinks([
      { placeId: "noodles", name: "Noodle Shop", website: "https://noodles.example" },
    ]);
    expect(htmlCalls).toBe(2);
    expect(second.restaurants[0]?.menuUrl).toBe("https://noodles.example/menu-2");
  });

  it("reuses cached menu page text when checking a dish", async () => {
    let pageCalls = 0;
    setMenuPageFetcher(async (url) => {
      pageCalls += 1;
      if (url.endsWith("/our-food")) {
        return "Kids Mini Burger $8.";
      }
      return "Home";
    });
    const { eventId, placeId } = await seedRestaurant();
    await checkMenuItem.execute({ eventId, placeId, item: "kids burger" });
    const second = await checkMenuItem.execute({ eventId, placeId, item: "kids burger" });
    expect(pageCalls).toBe(1);
    expect(second).toMatchObject({ found: true, sourceUrl: "https://noodles.example/our-food" });
  });

  async function seedRestaurant() {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-menu-cache-${crypto.randomUUID()}@example.com`,
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
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          website: "https://noodles.example",
          menuUrl: "https://noodles.example/our-food",
        },
      ],
    });
    return { eventId, placeId: "noodles" };
  }
});
