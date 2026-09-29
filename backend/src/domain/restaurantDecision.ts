import { councilScoreFor } from "./negotiate.js";
import { preferenceLabel } from "./preferences.js";
import type { Preference } from "./types.js";
import type { CouncilRestaurant, RestaurantConstraintCheck, UserRestaurantScore } from "./matchRestaurants.js";

export const RESTAURANT_DECISIONS = ["approve", "reject", "prefer", "dislike"] as const;
export const PREFER_POINTS = 10;
export const DISLIKE_POINTS = 10;

export type RestaurantDecisionKind = (typeof RESTAURANT_DECISIONS)[number];

export type RestaurantDecision = {
  userId: string;
  userName: string;
  decision: RestaurantDecisionKind;
  baseScore: number;
  at: string;
};

export function isRestaurantDecision(value: string): value is RestaurantDecisionKind {
  return (RESTAURANT_DECISIONS as readonly string[]).includes(value);
}

export function councilDecisionChat(input: {
  userName: string;
  restaurantName: string;
  decision: RestaurantDecisionKind;
}): string {
  const who = input.userName.trim() || "A participant";
  const place = input.restaurantName.trim() || "a restaurant";
  if (input.decision === "approve") {
    return `${who} approved ${place}.`;
  }
  if (input.decision === "reject") {
    return `${who} rejected ${place}.`;
  }
  if (input.decision === "prefer") {
    return `${who} prefers ${place}.`;
  }
  return `${who} disliked ${place}.`;
}

export function scoreFromDecision(baseScore: number, decision: RestaurantDecisionKind): number {
  if (decision === "reject") {
    return 0;
  }
  if (decision === "approve") {
    return 100;
  }
  if (decision === "prefer") {
    return Math.min(100, baseScore + PREFER_POINTS);
  }
  return Math.max(0, baseScore - DISLIKE_POINTS);
}

export function labelsForUserConstraints(preferences: Preference[], userId: string): string[] {
  return [
    ...new Set(
      preferences
        .filter((item) => item.userId === userId && item.priority === "HARD" && item.visibility === "PUBLIC")
        .map((item) => preferenceLabel(item).trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function applyRestaurantDecision(input: {
  restaurant: CouncilRestaurant;
  userId: string;
  userName: string;
  decision: RestaurantDecisionKind;
  nowIso: string;
  userConstraintLabels?: string[];
}): CouncilRestaurant {
  const prior = input.restaurant.decisions?.find((item) => item.userId === input.userId);
  const existing = input.restaurant.userScores?.find((item) => item.userId === input.userId);
  const baseScore = prior?.baseScore ?? existing?.score ?? 50;
  const record: RestaurantDecision = {
    userId: input.userId,
    userName: input.userName,
    decision: input.decision,
    baseScore,
    at: input.nowIso,
  };
  const decisions = [...(input.restaurant.decisions ?? []).filter((item) => item.userId !== input.userId), record];
  const nextScore = scoreFromDecision(baseScore, input.decision);
  const entry: UserRestaurantScore = {
    userId: input.userId,
    userName: input.userName,
    score: nextScore,
    baseScore,
    decision: input.decision,
  };
  const userScores = [...(input.restaurant.userScores ?? [])];
  const index = userScores.findIndex((item) => item.userId === input.userId);
  if (index < 0) {
    userScores.push(entry);
  } else {
    userScores[index] = { ...userScores[index], ...entry };
  }
  const next: CouncilRestaurant = {
    ...input.restaurant,
    decisions,
    userScores,
    constraintChecks: confirmApprovedConstraints(
      input.restaurant.constraintChecks,
      input.decision,
      input.userConstraintLabels ?? [],
      input.userName,
    ),
  };
  return { ...next, councilScore: councilScoreFor(next) };
}

export function mergeRestaurantDecisions(
  restaurants: CouncilRestaurant[],
  previous: CouncilRestaurant[],
): CouncilRestaurant[] {
  if (previous.length === 0) {
    return restaurants;
  }
  return restaurants.map((restaurant) => {
    const prior = previous.find((item) => item.placeId === restaurant.placeId);
    if (!prior?.decisions?.length) {
      return restaurant;
    }
    const userScores = [...(restaurant.userScores ?? [])];
    for (const decision of prior.decisions) {
      const index = userScores.findIndex((item) => item.userId === decision.userId);
      const computed = index < 0 ? 50 : userScores[index]!.score;
      const entry: UserRestaurantScore = {
        userId: decision.userId,
        userName: index < 0 ? decision.userName : userScores[index]!.userName,
        baseScore: computed,
        score: scoreFromDecision(computed, decision.decision),
        decision: decision.decision,
      };
      if (index < 0) {
        userScores.push(entry);
      } else {
        userScores[index] = { ...userScores[index], ...entry };
      }
    }
    const next: CouncilRestaurant = {
      ...restaurant,
      decisions: prior.decisions.map((item) => {
        const score = userScores.find((entry) => entry.userId === item.userId);
        return { ...item, baseScore: score?.baseScore ?? item.baseScore };
      }),
      userScores,
      constraintChecks: restoreApprovedConstraints(restaurant.constraintChecks, prior.constraintChecks),
    };
    return { ...next, councilScore: councilScoreFor(next) };
  });
}

function confirmApprovedConstraints(
  checks: RestaurantConstraintCheck[] | undefined,
  decision: RestaurantDecisionKind,
  labels: string[],
  userName: string,
): RestaurantConstraintCheck[] | undefined {
  if (decision !== "approve" || !checks?.length || labels.length === 0) {
    return checks;
  }
  const wanted = new Set(labels);
  return checks.map((check) =>
    wanted.has(check.label.trim().toLowerCase())
      ? { ...check, confirmed: true, confirmation: `Confirmed by ${userName} (approved).` }
      : check,
  );
}

function restoreApprovedConstraints(
  checks: RestaurantConstraintCheck[] | undefined,
  previous: RestaurantConstraintCheck[] | undefined,
): RestaurantConstraintCheck[] | undefined {
  if (!checks?.length) {
    return checks;
  }
  return checks.map((check) => {
    if (check.confirmed) {
      return check;
    }
    const prior =
      previous?.find((item) => item.id === check.id) ??
      previous?.find((item) => item.label.trim().toLowerCase() === check.label.trim().toLowerCase());
    if (!prior?.confirmed || !prior.confirmation) {
      return check;
    }
    return { ...check, confirmed: true, confirmation: prior.confirmation };
  });
}
