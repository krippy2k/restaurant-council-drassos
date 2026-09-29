import { describe, expect, it } from "vitest";
import {
  excerptAroundQuery,
  menuConfidence,
  menuPathCandidates,
  menuUrlFromOfficialSources,
  queryAppearsInMenuText,
} from "../src/domain/menuItem.ts";

describe("menu item matching", () => {
  it("builds menu URL candidates from a restaurant website", () => {
    expect(menuPathCandidates("https://noodles.example/home")).toEqual([
      "https://noodles.example/home",
      "https://noodles.example/menu",
      "https://noodles.example/menus",
      "https://noodles.example/food",
      "https://noodles.example/dinner",
      "https://noodles.example/order",
    ]);
  });

  it("finds a menu item when every meaningful token appears", () => {
    const text = "Kids Menu: Mini burger $8. Fried calamari $12.";
    expect(queryAppearsInMenuText(text, "kids burger")).toBe(true);
    expect(queryAppearsInMenuText(text, "calamari")).toBe(true);
    expect(queryAppearsInMenuText(text, "lobster roll")).toBe(false);
  });

  it("returns an excerpt around the matching query", () => {
    const excerpt = excerptAroundQuery("Welcome. Kids Menu: Mini burger $8. Desserts follow.", "kids burger");
    expect(excerpt?.toLowerCase()).toContain("mini burger");
  });

  it("treats a dedicated menu path as confirmed and a homepage match as likely", () => {
    expect(menuConfidence("https://noodles.example/menu")).toBe("confirmed");
    expect(menuConfidence("https://noodles.example/home")).toBe("likely");
  });

  it("uses the official menu URL when dietary sources found a menu page", () => {
    expect(
      menuUrlFromOfficialSources([
        { sourceType: "official-website", sourceUrl: "https://noodles.example" },
        { sourceType: "official-menu", sourceUrl: "https://noodles.example/menu" },
      ]),
    ).toBe("https://noodles.example/menu");
    expect(menuUrlFromOfficialSources([{ sourceType: "official-website", sourceUrl: "https://noodles.example" }])).toBeUndefined();
  });
});
