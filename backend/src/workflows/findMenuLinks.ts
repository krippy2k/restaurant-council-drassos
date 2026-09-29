import { defineAgent } from "@drassos/core";
import { menuLinksDraftSchema } from "../domain/menuLinks.js";

export const findMenuLinksAgent = defineAgent({
  name: "find-menu-links",
  model: "openai:gpt-4o-mini",
  instructions: [
    "You find each restaurant's food menu URL from its homepage.",
    "Input restaurants include website, a short pageText excerpt, and links harvested from that page (href + link text).",
    "Pick the URL that a diner would open to see dishes and prices.",
    "Only use a URL from that restaurant's links list. Never invent or guess a path like /menu.",
    "Prefer a dedicated menu, dinner, lunch, or PDF menu page over reservations, catering, gift cards, or generic order buttons when both exist.",
    "Third-party menu hosts such as Toast, Popmenu, BentoBox, or ChowNow are valid when they appear in the links.",
    "Omit a restaurant when none of its links look like a menu.",
    'Return JSON: {"menus":[{"placeId":"...","menuUrl":"https://..."}]}',
  ].join(" "),
  output: menuLinksDraftSchema,
  limits: {
    maxTurns: 2,
    timeout: "45s",
  },
});
