import { z } from "zod";
import type { CouncilParticipant, CouncilRestaurant } from "./matchRestaurants.js";
import { preferenceLabel } from "./preferences.js";
import type { Preference } from "./types.js";
import { clampCouncilScore } from "./negotiate.js";

const scoreSchema = z.object({
  placeId: z.string().min(1),
  score: z.number().min(0).max(100),
});

export type PersonalScore = {
  placeId: string;
  score: number;
};

export type PersonalScoreDraft = {
  scores: PersonalScore[];
};

function keepValidScores(value: unknown): PersonalScore[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const scores: PersonalScore[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const parsed = scoreSchema.safeParse({
      placeId: record.placeId ?? record.candidateId ?? record.id,
      score: clampCouncilScore(record.score),
    });
    if (!parsed.success || seen.has(parsed.data.placeId)) {
      continue;
    }
    seen.add(parsed.data.placeId);
    scores.push(parsed.data);
  }
  return scores;
}

export const personalScoreDraftSchema = z.preprocess(
  (value) => {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return { scores: keepValidScores(record.scores ?? record.restaurants) };
  },
  z.object({
    scores: z.array(scoreSchema).default([]),
  }),
);

export function inputForPersonalAgent(
  participant: CouncilParticipant,
  preferences: Preference[],
  restaurants: CouncilRestaurant[],
) {
  return {
    user: { id: participant.id, name: participant.name },
    preferences: preferences
      .filter((item) => item.userId === participant.id)
      .map((item) => ({
        category: item.category,
        priority: item.priority,
        visibility: item.visibility,
        label: preferenceLabel(item),
        ...(item.value ? { value: item.value } : {}),
      })),
    candidates: restaurants.map((restaurant) => ({
      placeId: restaurant.placeId,
      name: restaurant.name,
      ...(restaurant.priceLevel ? { priceLevel: restaurant.priceLevel } : {}),
      ...(typeof restaurant.rating === "number" ? { rating: restaurant.rating } : {}),
      ...(restaurant.types?.length ? { types: restaurant.types } : {}),
      ...(restaurant.servesVegetarianFood != null ? { servesVegetarianFood: restaurant.servesVegetarianFood } : {}),
      ...(restaurant.goodForChildren != null ? { goodForChildren: restaurant.goodForChildren } : {}),
      ...(restaurant.dietaryAssessments?.length
        ? {
            dietary: restaurant.dietaryAssessments.map((item) => ({
              requirement: item.requirement,
              status: item.status,
            })),
          }
        : {}),
    })),
  };
}

export function applyPersonalScore(
  restaurants: CouncilRestaurant[],
  participant: CouncilParticipant,
  draft: PersonalScoreDraft,
): CouncilRestaurant[] {
  const byPlace = new Map(draft.scores.map((item) => [item.placeId, item.score]));
  return restaurants.map((restaurant) => {
    const score = byPlace.get(restaurant.placeId);
    if (score === undefined) {
      return restaurant;
    }
    const userScores = [...(restaurant.userScores ?? [])];
    const index = userScores.findIndex((item) => item.userId === participant.id);
    const entry = { userId: participant.id, userName: participant.name, score };
    if (index < 0) {
      userScores.push(entry);
    } else {
      userScores[index] = { ...userScores[index], ...entry };
    }
    return { ...restaurant, userScores };
  });
}
