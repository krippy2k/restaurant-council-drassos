import { describe, expect, it } from "vitest";
import { restaurantMenuHref, telHref } from "./restaurantLinks";

describe("restaurant links", () => {
  it("builds a tel link from a formatted phone number", () => {
    expect(telHref("(786) 898-8868")).toBe("tel:7868988868");
  });

  it("uses an explicit menu URL when present", () => {
    expect(
      restaurantMenuHref({
        website: "https://noodles.example",
        menuUrl: "https://noodles.example/menu",
      }),
    ).toBe("https://noodles.example/menu");
  });

  it("treats a website path that is already a menu as the menu link", () => {
    expect(restaurantMenuHref({ website: "https://noodles.example/menu" })).toBe("https://noodles.example/menu");
  });

  it("does not invent a menu link from a homepage", () => {
    expect(restaurantMenuHref({ website: "https://noodles.example" })).toBeUndefined();
  });
});
