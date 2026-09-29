import { defineTool } from "@drassos/core";
import { z } from "zod";
import { excerptAroundQuery, menuConfidence, menuPathCandidates, queryAppearsInMenuText } from "../domain/menuItem.js";
import { findRestaurantByNameOrId } from "../domain/findRestaurant.js";
import { readCachedMenuPageOrFetch } from "../menuDetailsCache.js";
import { getRestaurantsForEvent } from "../restaurants.js";

export const checkMenuItemInputSchema = z.object({
  eventId: z.string().min(1),
  placeId: z.string().min(1),
  item: z.string().min(1).max(200),
});

export const checkMenuItemOutputSchema = z.object({
  found: z.boolean(),
  confidence: z.enum(["confirmed", "likely", "unknown"]),
  restaurantName: z.string(),
  placeId: z.string(),
  item: z.string(),
  excerpt: z.string().optional(),
  sourceUrl: z.string().optional(),
  reason: z.string().optional(),
});

export type CheckMenuItemInput = z.infer<typeof checkMenuItemInputSchema>;
export type CheckMenuItemOutput = z.infer<typeof checkMenuItemOutputSchema>;

export type MenuPageFetcher = (url: string) => Promise<string | null>;

let pageFetcher: MenuPageFetcher = fetchMenuPageText;

export function setMenuPageFetcher(next: MenuPageFetcher | undefined): void {
  pageFetcher = next ?? fetchMenuPageText;
}

export const checkMenuItem = defineTool({
  name: "check-menu-item",
  description:
    "Check a restaurant from an event council search for a named menu item using its website and menu pages. Returns found=false with confidence unknown when evidence is missing rather than inventing a no.",
  input: checkMenuItemInputSchema,
  output: checkMenuItemOutputSchema,
  execute: async (raw) => {
    const input = checkMenuItemInputSchema.parse(raw);
    const search = await getRestaurantsForEvent(input.eventId);
    const restaurant = findRestaurantByNameOrId(search?.restaurants ?? [], input.placeId);
    if (!restaurant) {
      throw Object.assign(new Error("That restaurant is not in this event."), { status: 404 });
    }
    const website = restaurant.website?.trim();
    const menuUrl = restaurant.menuUrl?.trim();
    if (!website && !menuUrl) {
      return {
        found: false,
        confidence: "unknown" as const,
        restaurantName: restaurant.name,
        placeId: restaurant.placeId,
        item: input.item,
        reason: "no_website",
      };
    }
    const urls = [
      ...new Set([menuUrl, ...(website ? menuPathCandidates(website) : [])].filter((item): item is string => Boolean(item))),
    ].slice(0, 6);
    for (const url of urls) {
      const text = await readCachedMenuPageOrFetch(url, pageFetcher);
      if (!text || !queryAppearsInMenuText(text, input.item)) {
        continue;
      }
      return {
        found: true,
        confidence: menuConfidence(url),
        restaurantName: restaurant.name,
        placeId: restaurant.placeId,
        item: input.item,
        excerpt: excerptAroundQuery(text, input.item),
        sourceUrl: url,
      };
    }
    return {
      found: false,
      confidence: "unknown" as const,
      restaurantName: restaurant.name,
      placeId: restaurant.placeId,
      item: input.item,
      reason: "not_mentioned",
    };
  },
});

const MAX_CHARS = 40_000;

async function fetchMenuPageText(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (/pdf|image\//i.test(contentType)) {
      return null;
    }
    return stripHtml(await response.text()) || null;
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}
