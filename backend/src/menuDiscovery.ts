import type { PlaceRestaurant } from "./domain/matchRestaurants.js";
import {
  extractPageLinks,
  heuristicMenuUrl,
  linksForMenuAgent,
  type PageLink,
} from "./domain/menuLinks.js";
import { getCachedMenuPlace, putCachedMenuPage, putCachedMenuPlace } from "./menuDetailsCache.js";

export type WebsiteHtmlFetcher = (url: string) => Promise<string | null>;

let htmlFetcher: WebsiteHtmlFetcher = fetchWebsiteHtml;

export function setWebsiteHtmlFetcher(next: WebsiteHtmlFetcher | undefined): void {
  htmlFetcher = next ?? fetchWebsiteHtml;
}

export type MenuLinkAgentRestaurant = {
  placeId: string;
  name: string;
  website: string;
  pageText?: string;
  links: PageLink[];
};

export type MenuHarvest<T extends PlaceRestaurant> = {
  restaurants: T[];
  agentInput: { restaurants: MenuLinkAgentRestaurant[] };
  allowed: Record<string, string[]>;
};

const MAX_PAGE_TEXT = 1_200;

export async function harvestMenuLinks<T extends PlaceRestaurant>(restaurants: T[]): Promise<MenuHarvest<T>> {
  const allowed: Record<string, string[]> = {};
  const agentRestaurants: MenuLinkAgentRestaurant[] = [];
  const next = await Promise.all(
    restaurants.map(async (restaurant) => {
      const website = restaurant.website?.trim();
      if (!website) {
        return restaurant;
      }
      const cached = await getCachedMenuPlace(restaurant.placeId, website);
      if (cached) {
        return cached.menuUrl ? { ...restaurant, menuUrl: cached.menuUrl } : restaurant;
      }
      const html = await htmlFetcher(website);
      if (!html) {
        return restaurant;
      }
      const links = extractPageLinks(html, website);
      const menuUrl = restaurant.menuUrl ?? heuristicMenuUrl(links, website);
      const permit = new Set(links.map((link) => link.href));
      if (menuUrl) {
        permit.add(menuUrl);
      }
      if (permit.size > 0) {
        allowed[restaurant.placeId] = [...permit];
        agentRestaurants.push({
          placeId: restaurant.placeId,
          name: restaurant.name,
          website,
          pageText: pageTextFromHtml(html),
          links: linksForMenuAgent(links),
        });
      }
      const pageText = pageTextFromHtml(html);
      if (pageText) {
        await putCachedMenuPage(website, pageText);
      }
      await putCachedMenuPlace(restaurant.placeId, website, menuUrl);
      return menuUrl ? { ...restaurant, menuUrl } : restaurant;
    }),
  );
  return { restaurants: next, agentInput: { restaurants: agentRestaurants }, allowed };
}

function pageTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PAGE_TEXT);
}

async function fetchWebsiteHtml(url: string): Promise<string | null> {
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
    const body = await response.text();
    return body || null;
  } catch {
    return null;
  }
}
