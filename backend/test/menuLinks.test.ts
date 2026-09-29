import { describe, expect, it } from "vitest";
import {
  applyMenuLinkPicks,
  extractPageLinks,
  heuristicMenuUrl,
  menuLinksDraftSchema,
} from "../src/domain/menuLinks.ts";

const html = `
  <nav>
    <a href="/about">About</a>
    <a href="/dinner-menu">Dinner Menu</a>
    <a href="https://order.toasttab.com/noodles">Order online</a>
    <a href="mailto:hi@noodles.example">Email</a>
    <a href="#top">Back to top</a>
  </nav>
`;

describe("homepage menu link harvest", () => {
  it("extracts same-site and menu-host links with their labels", () => {
    const links = extractPageLinks(html, "https://noodles.example");
    expect(links).toEqual(
      expect.arrayContaining([
        { href: "https://noodles.example/dinner-menu", text: "Dinner Menu" },
        { href: "https://order.toasttab.com/noodles", text: "Order online" },
        { href: "https://noodles.example/about", text: "About" },
      ]),
    );
    expect(links.some((link) => link.href.startsWith("mailto:"))).toBe(false);
    expect(links.some((link) => link.href.endsWith("#top"))).toBe(false);
  });

  it("picks a dinner-menu page over about and order links", () => {
    const links = extractPageLinks(html, "https://noodles.example");
    expect(heuristicMenuUrl(links, "https://noodles.example")).toBe("https://noodles.example/dinner-menu");
  });

  it("does not invent a menu URL from a homepage with no menu links", () => {
    const links = extractPageLinks(`<a href="/hours">Hours</a>`, "https://noodles.example");
    expect(heuristicMenuUrl(links, "https://noodles.example")).toBeUndefined();
  });

  it("lets the agent pick a harvested link and ignores invented URLs", () => {
    const restaurants = [
      { placeId: "noodles", name: "Noodle Shop", website: "https://noodles.example" },
      { placeId: "tacos", name: "Taco Stand", website: "https://tacos.example" },
    ];
    const allowed = new Map([
      ["noodles", new Set(["https://noodles.example/dinner-menu", "https://order.toasttab.com/noodles"])],
      ["tacos", new Set(["https://tacos.example/food"])],
    ]);
    const draft = menuLinksDraftSchema.parse({
      menus: [
        { placeId: "noodles", menuUrl: "https://order.toasttab.com/noodles" },
        { placeId: "tacos", menuUrl: "https://evil.example/not-on-page" },
      ],
    });
    const next = applyMenuLinkPicks(restaurants, draft, allowed);
    expect(next[0]?.menuUrl).toBe("https://order.toasttab.com/noodles");
    expect(next[1]?.menuUrl).toBeUndefined();
  });
});
