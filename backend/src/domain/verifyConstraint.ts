import type { CouncilRestaurant, RestaurantConstraintCheck } from "./matchRestaurants.js";

export const CONSTRAINT_VERIFICATION_RESULTS = ["meets", "does_not_meet", "unknown"] as const;
export const CONSTRAINT_CONTACT_METHODS = ["phone", "email", "in-person", "other"] as const;

export type ConstraintVerificationResult = (typeof CONSTRAINT_VERIFICATION_RESULTS)[number];
export type ConstraintContactMethod = (typeof CONSTRAINT_CONTACT_METHODS)[number];

export type ConstraintVerification = {
  id: string;
  result: ConstraintVerificationResult;
  method: ConstraintContactMethod;
  notes?: string;
  verifiedByUserId: string;
  verifiedByName: string;
  verifiedAt: string;
  summary: string;
};

const METHOD_PHRASE: Record<ConstraintContactMethod, string> = {
  phone: "via Phone",
  email: "via Email",
  "in-person": "in person",
  other: "via other contact",
};

export function isConstraintVerificationResult(value: string): value is ConstraintVerificationResult {
  return (CONSTRAINT_VERIFICATION_RESULTS as readonly string[]).includes(value);
}

export function isConstraintContactMethod(value: string): value is ConstraintContactMethod {
  return (CONSTRAINT_CONTACT_METHODS as readonly string[]).includes(value);
}

export function verificationSummary(input: {
  result: ConstraintVerificationResult;
  method: ConstraintContactMethod;
  verifiedByName: string;
  notes?: string;
}): string {
  const who = input.verifiedByName.trim() || "a participant";
  const via = METHOD_PHRASE[input.method];
  const base =
    input.result === "meets"
      ? `Confirmed ${via} by ${who}.`
      : input.result === "does_not_meet"
        ? `Does not meet this constraint, verified ${via} by ${who}.`
        : `Still unknown after checking ${via} by ${who}.`;
  const notes = input.notes?.trim();
  return notes ? `${base} ${notes}` : base;
}

export function applyVerificationToCheck(
  check: RestaurantConstraintCheck,
  verification: ConstraintVerification,
): RestaurantConstraintCheck {
  const verifications = [...(check.verifications ?? []), verification];
  return withVerifications(check, verifications);
}

export function constraintNeedsVerification(check: RestaurantConstraintCheck): boolean {
  const latest = check.verifications?.at(-1);
  if (latest?.result === "meets" || latest?.result === "does_not_meet") {
    return false;
  }
  return !check.confirmed;
}

export function mergeRestaurantVerifications(
  restaurants: CouncilRestaurant[],
  previous: CouncilRestaurant[],
): CouncilRestaurant[] {
  if (previous.length === 0) {
    return restaurants;
  }
  return restaurants.map((restaurant) => {
    const prior = previous.find((item) => item.placeId === restaurant.placeId);
    if (!prior?.constraintChecks?.length) {
      return restaurant;
    }
    return {
      ...restaurant,
      constraintChecks: (restaurant.constraintChecks ?? []).map((check) => {
        const priorCheck =
          prior.constraintChecks?.find((item) => item.id === check.id) ??
          prior.constraintChecks?.find((item) => item.label.trim().toLowerCase() === check.label.trim().toLowerCase());
        if (!priorCheck?.verifications?.length) {
          return check;
        }
        return withVerifications(check, priorCheck.verifications);
      }),
    };
  });
}

function withVerifications(
  check: RestaurantConstraintCheck,
  verifications: ConstraintVerification[],
): RestaurantConstraintCheck {
  const latest = verifications.at(-1);
  if (!latest) {
    return { ...check, verifications };
  }
  if (latest.result === "meets") {
    return {
      ...check,
      verifications,
      confirmed: true,
      confirmation: latest.summary,
    };
  }
  if (latest.result === "does_not_meet") {
    return {
      ...check,
      verifications,
      confirmed: false,
      confirmation: latest.summary,
    };
  }
  return {
    ...check,
    verifications,
    confirmed: check.confirmed,
    confirmation: check.confirmed ? check.confirmation : latest.summary,
  };
}
