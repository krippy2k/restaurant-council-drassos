import type { Preference } from "./domain/types.js";
import type { PlaceRestaurant } from "./domain/matchRestaurants.js";
import { menuUrlFromOfficialSources } from "./domain/menuItem.js";
import { readCachedMenuPageOrFetch } from "./menuDetailsCache.js";
import {
  assessDietaryEvidence,
  dietaryRequirementsFromPreferences,
  evidenceFromText,
  type DietaryAssessment,
  type DietaryEvidence,
} from "./domain/dietary.js";

export type DietaryLookup = <T extends PlaceRestaurant>(
  restaurants: T[],
  requirements: string[],
) => Promise<T[]>;

let lookup: DietaryLookup = lookupDietaryFromSources;

export function setDietaryLookup(next: DietaryLookup | undefined): void {
  lookup = next ?? lookupDietaryFromSources;
}

export async function attachDietaryAssessments<T extends PlaceRestaurant>(
  restaurants: T[],
  preferences: Preference[],
): Promise<T[]> {
  const requirements = dietaryRequirementsFromPreferences(preferences);
  if (requirements.length === 0 || restaurants.length === 0) {
    return restaurants;
  }
  return lookup(restaurants, requirements) as Promise<T[]>;
}

async function lookupDietaryFromSources<T extends PlaceRestaurant>(
  restaurants: T[],
  requirements: string[],
): Promise<T[]> {
  return Promise.all(
    restaurants.map(async (restaurant) => {
      try {
        const sources = restaurant.website
          ? await officialSourceTexts(restaurant.website, restaurant.menuUrl)
          : restaurant.menuUrl
            ? await officialSourceTexts(restaurant.menuUrl, restaurant.menuUrl)
            : [];
        const assessments = requirements.map((requirement) =>
          assessDietaryEvidence({
            restaurantId: restaurant.placeId,
            requirement,
            evidence: evidenceForRequirement(restaurant, requirement, sources),
          }),
        );
        return {
          ...restaurant,
          dietaryAssessments: assessments,
          menuUrl: restaurant.menuUrl ?? menuUrlFromOfficialSources(sources),
        };
      } catch {
        return {
          ...restaurant,
          dietaryAssessments: requirements.map((requirement) => ({
            restaurantId: restaurant.placeId,
            requirement,
            status: "uncertain" as const,
            confidence: 0.2,
            evidence: [],
          })),
        };
      }
    }),
  );
}

function evidenceForRequirement(
  restaurant: PlaceRestaurant,
  requirement: string,
  sources: OfficialSourceText[],
): DietaryEvidence[] {
  return [
    ...structuredEvidence(restaurant, requirement),
    ...sources.flatMap((source) =>
      evidenceFromText({
        text: source.text,
        requirement,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        sourceName: source.sourceName,
        reliability: "medium",
      }),
    ),
    ...(restaurant.reviews ?? []).flatMap((review) =>
      evidenceFromText({
        text: review.text,
        requirement,
        sourceType: "review",
        sourceName: review.authorName ?? "Guest review",
        reliability: "low",
      }),
    ),
  ];
}

function structuredEvidence(restaurant: PlaceRestaurant, requirement: string): DietaryEvidence[] {
  const vegetarian =
    restaurant.servesVegetarianFood === true ||
    (restaurant.types ?? []).some((type) => /vegetarian/i.test(type)) ||
    restaurant.primaryType === "vegetarian_restaurant";
  const vegan =
    (restaurant.types ?? []).some((type) => /vegan/i.test(type)) || restaurant.primaryType === "vegan_restaurant";
  const evidence: DietaryEvidence[] = [];
  if (vegetarian && requirement === "vegetarian") {
    evidence.push({
      id: crypto.randomUUID(),
      sourceType: "structured-provider",
      sourceName: "Google Places",
      excerpt: "Provider lists vegetarian options.",
      supports: "supports",
      reliability: "high",
    });
  }
  if (vegan && (requirement === "vegan" || requirement === "dairy-free")) {
    evidence.push({
      id: crypto.randomUUID(),
      sourceType: "structured-provider",
      sourceName: "Google Places",
      excerpt: "Provider lists vegan options.",
      supports: "supports",
      reliability: "high",
    });
  }
  return evidence;
}

const MAX_CHARS = 40_000;
const EXTRA_PATHS = ["/menu", "/menus", "/allergen", "/allergens", "/nutrition"];

type OfficialSourceText = {
  text: string;
  sourceType: Extract<DietaryEvidence["sourceType"], "official-menu" | "official-website">;
  sourceUrl: string;
  sourceName: string;
};

async function officialSourceTexts(website: string, menuUrl?: string): Promise<OfficialSourceText[]> {
  const sources: OfficialSourceText[] = [];
  const homepage = await fetchWebsiteText(website);
  if (homepage) {
    sources.push({
      text: homepage,
      sourceType: /menu/i.test(website) ? "official-menu" : "official-website",
      sourceUrl: website,
      sourceName: /menu/i.test(website) ? "the menu" : "the website",
    });
  }
  try {
    const origin = new URL(website).origin;
    for (const path of EXTRA_PATHS) {
      const url = new URL(path, origin).toString();
      const extra = await fetchWebsiteText(url);
      if (!extra) {
        continue;
      }
      const isMenu = /menu/i.test(path);
      sources.push({
        text: extra,
        sourceType: isMenu ? "official-menu" : "official-website",
        sourceUrl: url,
        sourceName: isMenu ? "the menu" : /allergen|nutrition/i.test(path) ? "allergen information" : "the website",
      });
    }
  } catch {
    // Keep homepage text if extra paths cannot be resolved.
  }
  const explicitMenu = menuUrl?.trim();
  if (explicitMenu && !sources.some((item) => item.sourceUrl === explicitMenu)) {
    const menuText = await fetchWebsiteText(explicitMenu);
    if (menuText) {
      sources.unshift({
        text: menuText,
        sourceType: "official-menu",
        sourceUrl: explicitMenu,
        sourceName: "the menu",
      });
    }
  }
  return sources;
}

export async function fetchOfficialRestaurantText(website: string): Promise<string | null> {
  const sources = await officialSourceTexts(website);
  const combined = sources
    .map((source) => source.text)
    .join(" ")
    .trim();
  return combined ? combined.slice(0, MAX_CHARS) : null;
}

async function fetchWebsiteText(url: string): Promise<string | null> {
  return readCachedMenuPageOrFetch(url, fetchWebsiteTextUncached);
}

async function fetchWebsiteTextUncached(url: string): Promise<string | null> {
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
    const body = stripHtml(await response.text());
    return body || null;
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

export type { DietaryAssessment };
