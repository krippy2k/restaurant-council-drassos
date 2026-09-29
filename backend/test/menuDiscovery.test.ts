import { afterEach, describe, expect, it } from "vitest";
import { harvestMenuLinks, setWebsiteHtmlFetcher } from "../src/menuDiscovery.ts";
import { clearMenuDetailsCache } from "../src/menuDetailsCache.ts";

describe("menu discovery harvest", () => {
  afterEach(async () => {
    setWebsiteHtmlFetcher(undefined);
    await clearMenuDetailsCache();
  });

  it("sets a heuristic menu URL and builds agent input from homepage links", async () => {
    setWebsiteHtmlFetcher(async (url) => {
      expect(url).toBe("https://noodles.example");
      return `<nav><a href="/dinner-menu">Dinner Menu</a><a href="/about">About</a></nav>`;
    });
    const harvested = await harvestMenuLinks([
      { placeId: "noodles", name: "Noodle Shop", website: "https://noodles.example" },
      { placeId: "secret", name: "Secret Kitchen" },
    ]);
    expect(harvested.restaurants[0]?.menuUrl).toBe("https://noodles.example/dinner-menu");
    expect(harvested.restaurants[1]?.menuUrl).toBeUndefined();
    expect(harvested.agentInput.restaurants).toEqual([
      expect.objectContaining({
        placeId: "noodles",
        website: "https://noodles.example",
        links: expect.arrayContaining([{ href: "https://noodles.example/dinner-menu", text: "Dinner Menu" }]),
      }),
    ]);
    expect(harvested.allowed.noodles).toContain("https://noodles.example/dinner-menu");
  });
});
