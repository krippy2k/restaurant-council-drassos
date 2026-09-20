import type { ConstraintVerification } from "./verifyConstraint.js";
import type { Event, EventConstraint, Preference } from "./types.js";
import {
  assessmentIsUnsupported,
  dietaryRequirementForPreference,
  scoreFromDietaryAssessment,
  type DietaryAssessment,
} from "./dietary.js";
import { preferenceLabel } from "./preferences.js";

export type PlaceRestaurant = {
  placeId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  priceLevel?: string;
  types?: string[];
  primaryType?: string;
  rating?: number;
  reviewCount?: number;
  servesVegetarianFood?: boolean | null;
  goodForChildren?: boolean | null;
  photoUrl?: string;
  hours?: string[];
  openNow?: boolean | null;
  website?: string;
  phone?: string;
  email?: string;
  reviews?: Array<{ text: string; authorName?: string; publishedAt?: string }>;
  dietaryAssessments?: DietaryAssessment[];
};

export type CouncilRestaurant = PlaceRestaurant & {
  matched: true;
  userScores?: UserRestaurantScore[];
  constraintFlags?: RestaurantConstraintFlag[];
  constraintChecks?: RestaurantConstraintCheck[];
  councilScore?: number;
  explanations?: string[];
  picked?: boolean;
};

export type RestaurantConstraintFlag = {
  id: string;
  label: string;
  status: "mismatch" | "uncertain";
};

export type RestaurantConstraintCheck = {
  id: string;
  label: string;
  confirmed: boolean;
  confirmation?: string;
  verifications?: ConstraintVerification[];
};

export type UserRestaurantScore = {
  userId: string;
  userName: string;
  score: number;
};

export type CouncilParticipant = {
  id: string;
  name: string;
};

export type HardConstraint = {
  id: string;
  label: string;
  publicLabel: string;
  kind: "price" | "kid-friendly" | "vegetarian" | "other";
  maxDollars?: number;
};

export function hardConstraintsForEvent(event: Event, preferences: Preference[]): HardConstraint[] {
  const items: HardConstraint[] = [];
  for (const constraint of event.constraints ?? []) {
    if (constraint.strength === "preferred") {
      continue;
    }
    items.push(eventConstraintToHard(constraint));
  }
  for (const preference of preferences) {
    if (preference.priority !== "HARD") {
      continue;
    }
    items.push(preferenceToHard(preference));
  }
  return items;
}

function eventConstraintToHard(constraint: EventConstraint): HardConstraint {
  const type = constraint.type.trim().toLowerCase();
  return {
    id: `event:${type}`,
    label: constraint.label,
    publicLabel: constraint.label,
    kind: type === "kid-friendly" ? "kid-friendly" : /vegetarian|vegan/.test(type) ? "vegetarian" : "other",
  };
}

function preferenceToHard(preference: Preference): HardConstraint {
  const label = preferenceLabel(preference);
  const type = String(preference.value?.type ?? "").toLowerCase();
  const maxDollars = typeof preference.value?.maxDollars === "number" ? preference.value.maxDollars : undefined;
  const vegetarian = /vegetarian|vegan/.test(`${type} ${label}`);
  const kind = preference.category === "price" || maxDollars ? "price" : vegetarian ? "vegetarian" : "other";
  const publicLabel = preference.visibility === "PRIVATE" ? "a required private constraint" : label;
  return {
    id: preference.id,
    label,
    publicLabel,
    kind,
    maxDollars,
  };
}

export function confirmedMismatch(place: PlaceRestaurant, constraint: HardConstraint): boolean {
  if (constraint.kind === "price" && typeof constraint.maxDollars === "number") {
    return confirmedOverBudget(place.priceLevel, constraint.maxDollars);
  }
  if (constraint.kind === "kid-friendly") {
    return place.goodForChildren === false;
  }
  if (constraint.kind === "vegetarian") {
    const assessment = place.dietaryAssessments?.find(
      (item) => item.requirement === "vegetarian" || item.requirement === "vegan",
    );
    if (assessmentIsUnsupported(assessment)) {
      return true;
    }
    if (assessment && (assessment.status === "confirmed" || assessment.status === "likely")) {
      return false;
    }
    return place.servesVegetarianFood === false;
  }
  return false;
}

export function keepMatchingRestaurants(
  places: PlaceRestaurant[],
  constraints: HardConstraint[],
): CouncilRestaurant[] {
  return places
    .filter((place) => !constraints.some((constraint) => confirmedMismatch(place, constraint)))
    .map((place) => ({ ...place, matched: true as const }));
}

export function attachUserScores(
  restaurants: CouncilRestaurant[],
  participants: CouncilParticipant[],
  preferences: Preference[],
  event?: Event,
): CouncilRestaurant[] {
  return restaurants.map((restaurant) => ({
    ...restaurant,
    userScores: participants.map((user) => ({
      userId: user.id,
      userName: user.name,
      score: scorePlaceForUser(
        restaurant,
        preferences.filter((preference) => preference.userId === user.id),
      ),
    })),
    constraintFlags: constraintFlagsForPlace(restaurant, preferences, event),
    constraintChecks: constraintChecksForPlace(restaurant, preferences, event),
  }));
}

export function constraintChecksForPlace(
  place: PlaceRestaurant,
  preferences: Preference[],
  event?: Event,
): RestaurantConstraintCheck[] {
  const checks: RestaurantConstraintCheck[] = [];
  const seen = new Set<string>();
  const add = (check: RestaurantConstraintCheck) => {
    const key = check.label.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    checks.push(check);
  };
  for (const constraint of event?.constraints ?? []) {
    if (constraint.strength === "preferred") {
      continue;
    }
    add(checkForHardConstraint(place, eventConstraintToHard(constraint)));
  }
  for (const preference of preferences) {
    if (preference.priority !== "HARD" || preference.visibility !== "PUBLIC") {
      continue;
    }
    add(checkForPreference(place, preference));
  }
  return checks;
}

export function constraintFlagsForPlace(
  place: PlaceRestaurant,
  preferences: Preference[],
  event?: Event,
): RestaurantConstraintFlag[] {
  const flags: RestaurantConstraintFlag[] = [];
  const publicHardLabels = new Set(
    constraintChecksForPlace(place, preferences, event).map((item) => item.label.trim().toLowerCase()),
  );
  for (const constraint of event?.constraints ?? []) {
    const hard = eventConstraintToHard(constraint);
    if (publicHardLabels.has(hard.publicLabel.trim().toLowerCase())) {
      continue;
    }
    const status = hardConstraintStatus(place, hard);
    if (status === "match" || status === "skip") {
      continue;
    }
    flags.push({ id: hard.id, label: hard.publicLabel, status });
  }
  for (const preference of preferences) {
    if (preference.priority === "HARD" && preference.visibility === "PUBLIC") {
      continue;
    }
    const status = preferenceStatus(place, preference);
    if (status === "match") {
      continue;
    }
    flags.push({
      id: preference.id,
      label: preference.visibility === "PRIVATE" ? "A private constraint" : preferenceLabel(preference),
      status,
    });
  }
  return flags;
}

function checkForHardConstraint(place: PlaceRestaurant, constraint: HardConstraint): RestaurantConstraintCheck {
  if (constraint.kind === "vegetarian") {
    const assessment = place.dietaryAssessments?.find(
      (item) => item.requirement === "vegetarian" || item.requirement === "vegan",
    );
    if (assessment?.status === "confirmed") {
      return {
        id: constraint.id,
        label: constraint.publicLabel,
        confirmed: true,
        confirmation: confirmationFromEvidence(assessment.evidence),
      };
    }
    if (place.servesVegetarianFood === true) {
      return {
        id: constraint.id,
        label: constraint.publicLabel,
        confirmed: true,
        confirmation: "Confirmed by Google Places",
      };
    }
    return { id: constraint.id, label: constraint.publicLabel, confirmed: false };
  }
  const status = hardConstraintStatus(place, constraint);
  if (status === "match") {
    return {
      id: constraint.id,
      label: constraint.publicLabel,
      confirmed: true,
      confirmation: confirmationForHardKind(constraint.kind),
    };
  }
  return { id: constraint.id, label: constraint.publicLabel, confirmed: false };
}

function checkForPreference(place: PlaceRestaurant, preference: Preference): RestaurantConstraintCheck {
  const label = preferenceLabel(preference);
  const requirement = dietaryRequirementForPreference(preference);
  if (requirement) {
    const assessment = place.dietaryAssessments?.find((item) => item.requirement === requirement);
    if (assessment?.status === "confirmed") {
      return {
        id: preference.id,
        label,
        confirmed: true,
        confirmation: confirmationFromEvidence(assessment.evidence),
      };
    }
    if (requirement === "vegetarian" && place.servesVegetarianFood === true) {
      return {
        id: preference.id,
        label,
        confirmed: true,
        confirmation: "Confirmed by Google Places",
      };
    }
    return { id: preference.id, label, confirmed: false };
  }
  const status = preferenceStatus(place, preference);
  if (status === "match") {
    return {
      id: preference.id,
      label,
      confirmed: true,
      confirmation: confirmationForHardKind(preferenceKind(preference)),
    };
  }
  return { id: preference.id, label, confirmed: false };
}

function confirmationForHardKind(kind: HardConstraint["kind"] | "cuisine"): string {
  if (kind === "price") {
    return "Confirmed by listed price level";
  }
  if (kind === "cuisine") {
    return "Confirmed by listed cuisine";
  }
  return "Confirmed by Google Places";
}

function confirmationFromEvidence(evidence: DietaryAssessment["evidence"]): string {
  const supporting = evidence.filter((item) => item.supports === "supports");
  const official = supporting.filter(
    (item) =>
      item.sourceType === "official-menu" ||
      item.sourceType === "official-website" ||
      item.sourceType === "structured-provider",
  );
  const sources = [...new Set((official.length > 0 ? official : supporting).map(confirmationSource))];
  if (sources.length === 0) {
    return "Confirmed by listed information";
  }
  if (sources.length === 1) {
    return `Confirmed by ${sources[0]}`;
  }
  if (sources.length === 2) {
    return `Confirmed by ${sources[0]} and ${sources[1]}`;
  }
  return `Confirmed by ${sources.slice(0, -1).join(", ")}, and ${sources[sources.length - 1]}`;
}

function confirmationSource(item: DietaryAssessment["evidence"][number]): string {
  const named = (item.sourceName ?? "").trim().toLowerCase();
  if (named === "the menu" || named === "the website" || named === "allergen information" || named === "google places") {
    return item.sourceName!.trim();
  }
  if (item.sourceType === "official-menu") {
    return "the menu";
  }
  if (item.sourceType === "official-website") {
    return /allergen|nutrition/i.test(`${item.sourceUrl ?? ""} ${item.sourceName ?? ""}`)
      ? "allergen information"
      : "the website";
  }
  if (item.sourceType === "structured-provider") {
    return "Google Places";
  }
  if (item.sourceType === "review") {
    return "guest reviews";
  }
  return "listed information";
}

function preferenceStatus(place: PlaceRestaurant, preference: Preference): "match" | "mismatch" | "uncertain" {
  const requirement = dietaryRequirementForPreference(preference);
  if (requirement) {
    const assessment = place.dietaryAssessments?.find((item) => item.requirement === requirement);
    const score = scoreFromDietaryAssessment(assessment);
    if (score >= 100) {
      return "match";
    }
    if (score <= 0) {
      return "mismatch";
    }
    return "uncertain";
  }
  const score = scorePreference(place, preference);
  if (score >= 100) {
    return "match";
  }
  if (score <= 0) {
    return "mismatch";
  }
  return "uncertain";
}

function hardConstraintStatus(
  place: PlaceRestaurant,
  constraint: HardConstraint,
): "match" | "mismatch" | "uncertain" | "skip" {
  if (constraint.kind === "price") {
    if (typeof constraint.maxDollars !== "number") {
      return "skip";
    }
    if (!place.priceLevel) {
      return "uncertain";
    }
    return confirmedOverBudget(place.priceLevel, constraint.maxDollars) ? "mismatch" : "match";
  }
  if (constraint.kind === "kid-friendly") {
    if (place.goodForChildren == null) {
      return "uncertain";
    }
    return place.goodForChildren ? "match" : "mismatch";
  }
  if (constraint.kind === "vegetarian") {
    const assessment = place.dietaryAssessments?.find(
      (item) => item.requirement === "vegetarian" || item.requirement === "vegan",
    );
    if (assessment?.status === "confirmed" || assessment?.status === "likely") {
      return "match";
    }
    if (assessmentIsUnsupported(assessment) || place.servesVegetarianFood === false) {
      return "mismatch";
    }
    if (place.servesVegetarianFood === true) {
      return "match";
    }
    return "uncertain";
  }
  return "skip";
}

export function scorePlaceForUser(place: PlaceRestaurant, preferences: Preference[]): number {
  if (preferences.length === 0) {
    return 100;
  }
  let weighted = 0;
  let total = 0;
  for (const preference of preferences) {
    const weight = priorityWeight(preference.priority);
    weighted += scorePreference(place, preference) * weight;
    total += weight;
  }
  return total === 0 ? 100 : Math.round(weighted / total);
}

function priorityWeight(priority: Preference["priority"]): number {
  if (priority === "HARD") {
    return 4;
  }
  if (priority === "HIGH") {
    return 3;
  }
  if (priority === "MEDIUM") {
    return 2;
  }
  return 1;
}

function scorePreference(place: PlaceRestaurant, preference: Preference): number {
  const requirement = dietaryRequirementForPreference(preference);
  if (requirement) {
    const assessment = place.dietaryAssessments?.find((item) => item.requirement === requirement);
    if (assessment) {
      return scoreFromDietaryAssessment(assessment);
    }
    if (requirement === "vegetarian") {
      if (place.servesVegetarianFood == null) {
        return 50;
      }
      return place.servesVegetarianFood ? 100 : 0;
    }
    if (requirement === "vegan") {
      return 50;
    }
    return 50;
  }
  const kind = preferenceKind(preference);
  if (kind === "price") {
    const maxDollars =
      typeof preference.value?.maxDollars === "number" ? preference.value.maxDollars : undefined;
    if (typeof maxDollars !== "number") {
      return 50;
    }
    if (!place.priceLevel) {
      return 50;
    }
    return confirmedOverBudget(place.priceLevel, maxDollars) ? 0 : 100;
  }
  if (kind === "kid-friendly") {
    if (place.goodForChildren == null) {
      return 50;
    }
    return place.goodForChildren ? 100 : 0;
  }
  if (kind === "vegetarian") {
    if (place.servesVegetarianFood == null) {
      return 50;
    }
    return place.servesVegetarianFood ? 100 : 0;
  }
  if (kind === "cuisine") {
    const blob = placeText(place);
    const terms = cuisineTerms(preference);
    if (terms.length === 0) {
      return 50;
    }
    return terms.some((term) => blob.includes(term)) ? 100 : 0;
  }
  return 50;
}

function preferenceKind(preference: Preference): HardConstraint["kind"] | "cuisine" {
  const label = preferenceLabel(preference);
  const type = String(preference.value?.type ?? "").toLowerCase();
  const haystack = `${preference.category} ${type} ${label}`.toLowerCase();
  if (preference.category === "cuisine") {
    return "cuisine";
  }
  if (preference.category === "price" || typeof preference.value?.maxDollars === "number") {
    return "price";
  }
  if (/vegetarian|vegan/.test(haystack)) {
    return "vegetarian";
  }
  if (/kid|child/.test(haystack)) {
    return "kid-friendly";
  }
  return "other";
}

function placeText(place: PlaceRestaurant): string {
  return [place.name, ...(place.types ?? [])].join(" ").toLowerCase().replace(/[_-]+/g, " ");
}

function cuisineTerms(preference: Preference): string[] {
  const stop = new Set([
    "a",
    "an",
    "and",
    "cuisine",
    "food",
    "for",
    "like",
    "likes",
    "prefer",
    "preferred",
    "restaurant",
    "some",
    "the",
  ]);
  const raw = `${String(preference.value?.type ?? "")} ${preferenceLabel(preference)}`.toLowerCase();
  return [...new Set(raw.split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !stop.has(word)))];
}

function confirmedOverBudget(priceLevel: string | undefined, maxDollars: number): boolean {
  const level = (priceLevel ?? "").toUpperCase();
  if (level === "PRICE_LEVEL_VERY_EXPENSIVE" || level === "VERY_EXPENSIVE") {
    return maxDollars < 80;
  }
  if (level === "PRICE_LEVEL_EXPENSIVE" || level === "EXPENSIVE") {
    return maxDollars < 40;
  }
  if (level === "PRICE_LEVEL_MODERATE" || level === "MODERATE") {
    return maxDollars < 15;
  }
  return false;
}
