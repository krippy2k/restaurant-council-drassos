import { z } from "zod";
import type { Preference } from "./types.js";
import { preferenceLabel } from "./preferences.js";
import type { CouncilRestaurant } from "./matchRestaurants.js";

const UNSAFE_EXPLANATION =
  /afford|budget|salary|lost (a |the )?job|money is tight|can't pay|cannot pay|under \$\d+|max_price|price level|private preference was|told me that|allerg(y|ies)|celiac|medical|has a dairy|don't tell/i;

const MEMBER_COUNT_EXPLANATION = /\d+\s*\/\s*\d+\s+members|\b\d+\s+members\b/i;

export function isSafeExplanation(text: string): boolean {
  return text.trim().length > 0 && text.length <= 180 && !UNSAFE_EXPLANATION.test(text);
}

export function mergeExplanations(computed: string[], proposed: string[]): string[] {
  const extras = proposed.filter(
    (text) => isSafeExplanation(text) && !MEMBER_COUNT_EXPLANATION.test(text),
  );
  const merged = [...computed];
  for (const extra of extras) {
    if (extra === "Within everyone's hard constraints" && !computed.includes(extra)) {
      continue;
    }
    if (!merged.includes(extra)) {
      merged.push(extra);
    }
  }
  return merged;
}

export function councilScoreFor(restaurant: CouncilRestaurant): number {
  const scores = restaurant.userScores ?? [];
  if (scores.length === 0) {
    return 0;
  }
  return Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length);
}

export function computedExplanations(restaurant: CouncilRestaurant): string[] {
  const explanations: string[] = [];
  if (allHardConstraintsConfirmed(restaurant)) {
    explanations.push("Within everyone's hard constraints");
  }
  const scores = restaurant.userScores ?? [];
  const strong = scores.filter((item) => item.score >= 85).length;
  if (scores.length > 0 && strong > 0) {
    explanations.push(`Strong match for ${strong}/${scores.length} members`);
  }
  if ((restaurant.rating ?? 0) >= 4.4) {
    explanations.push("Strong diner ratings");
  }
  if (restaurant.servesVegetarianFood === true) {
    explanations.push("Meets the group's dietary requirements");
  }
  if (restaurant.goodForChildren === true) {
    explanations.push("Kid friendly");
  }
  return explanations;
}

function allHardConstraintsConfirmed(restaurant: CouncilRestaurant): boolean {
  const checks = restaurant.constraintChecks ?? [];
  const privateHardOpen = (restaurant.constraintFlags ?? []).some(
    (flag) => flag.label === "A private constraint",
  );
  if (privateHardOpen || checks.length === 0) {
    return false;
  }
  return checks.every((item) => item.confirmed);
}

export type NegotiatorPick = {
  candidateId: string;
  explanations: string[];
  score?: number;
};

export type NegotiatorScore = {
  candidateId: string;
  score: number;
};

export type NegotiationDraft = {
  picks: NegotiatorPick[];
  scores: NegotiatorScore[];
};

export function clampCouncilScore(value: unknown): number | undefined {
  const raw = typeof value === "string" ? value.replace(/%/g, "").trim() : value;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  const pct = n > 0 && n < 1 ? Math.round(n * 100) : Math.round(n);
  return Math.min(100, Math.max(0, pct));
}

const pickSchema = z.object({
  candidateId: z.string().min(1),
  explanations: z.array(z.string().max(180)).max(5).default([]),
  score: z.number().min(0).max(100).optional(),
});

const scoreSchema = z.object({
  candidateId: z.string().min(1),
  score: z.number().min(0).max(100),
});

function keepValidPicks(value: unknown): NegotiatorPick[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const picks: NegotiatorPick[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const explanations = Array.isArray(record.explanations)
      ? record.explanations
      : typeof record.explanations === "string"
        ? [record.explanations]
        : [];
    const parsed = pickSchema.safeParse({
      candidateId: record.candidateId ?? record.placeId ?? record.id,
      explanations,
      score: clampCouncilScore(record.score ?? record.councilScore),
    });
    if (parsed.success) {
      picks.push(parsed.data);
    }
  }
  return picks.slice(0, 3);
}

function keepValidScores(value: unknown): NegotiatorScore[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const scores: NegotiatorScore[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const parsed = scoreSchema.safeParse({
      candidateId: record.candidateId ?? record.placeId ?? record.id,
      score: clampCouncilScore(record.score ?? record.councilScore),
    });
    if (parsed.success) {
      scores.push(parsed.data);
    }
  }
  return scores;
}

export const negotiationDraftSchema = z.preprocess(
  (value) => {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
      picks: keepValidPicks(record.picks),
      scores: keepValidScores(record.scores ?? record.restaurants),
    };
  },
  z.object({
    picks: z.array(pickSchema).max(3).default([]),
    scores: z.array(scoreSchema).default([]),
  }),
);

export function constraintsForNegotiator(preferences: Preference[]): Array<{
  userId: string;
  category: string;
  priority: string;
  visibility: string;
  label: string;
  value?: Preference["value"];
}> {
  return preferences.map((preference) => {
    const privatePref = preference.visibility === "PRIVATE";
    return {
      userId: preference.userId,
      category: preference.category,
      priority: preference.priority,
      visibility: preference.visibility,
      label: privatePref ? "PRIVATE_DERIVED" : preferenceLabel(preference),
      ...(preference.value ? { value: preference.value } : {}),
    };
  });
}

export function candidatesForNegotiator(restaurants: CouncilRestaurant[]) {
  return restaurants.map((restaurant) => ({
    id: restaurant.placeId,
    name: restaurant.name,
    ...(restaurant.priceLevel ? { priceLevel: restaurant.priceLevel } : {}),
    ...(typeof restaurant.rating === "number" ? { rating: restaurant.rating } : {}),
    ...(restaurant.types?.length ? { types: restaurant.types } : {}),
    councilScore: councilScoreFor(restaurant),
    ...(restaurant.userScores?.length ? { userScores: restaurant.userScores } : {}),
  }));
}

export function applyNegotiatorPicks(
  restaurants: CouncilRestaurant[],
  draft: NegotiationDraft | NegotiatorPick[],
): CouncilRestaurant[] {
  const picks = Array.isArray(draft) ? draft : draft.picks;
  const extraScores = Array.isArray(draft) ? [] : draft.scores;
  const scoreById = new Map<string, number>();
  for (const item of extraScores) {
    scoreById.set(item.candidateId, item.score);
  }
  for (const pick of picks) {
    if (typeof pick.score === "number") {
      scoreById.set(pick.candidateId, pick.score);
    }
  }
  const prepared = restaurants.map((restaurant) => ({
    ...restaurant,
    councilScore: scoreById.get(restaurant.placeId) ?? councilScoreFor(restaurant),
    explanations: computedExplanations(restaurant),
    picked: false,
  }));
  const byId = new Map(prepared.map((item) => [item.placeId, item]));
  const selected: CouncilRestaurant[] = [];
  const used = new Set<string>();
  for (const pick of picks) {
    const base = byId.get(pick.candidateId);
    if (!base || used.has(base.placeId)) {
      continue;
    }
    used.add(base.placeId);
    selected.push({
      ...base,
      picked: true,
      explanations: mergeExplanations(base.explanations ?? [], pick.explanations),
    });
    if (selected.length >= 3) {
      break;
    }
  }
  const rest = prepared
    .filter((item) => !used.has(item.placeId))
    .sort((left, right) => (right.councilScore ?? 0) - (left.councilScore ?? 0));
  if (selected.length === 0) {
    return prepared
      .sort((left, right) => (right.councilScore ?? 0) - (left.councilScore ?? 0))
      .map((item, index) => ({ ...item, picked: index < 3 }));
  }
  return [...selected, ...rest];
}
