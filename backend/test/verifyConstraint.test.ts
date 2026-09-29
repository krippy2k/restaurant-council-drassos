import { describe, expect, it } from "vitest";
import {
  applyVerificationToCheck,
  councilVerificationChat,
  mergeRestaurantVerifications,
  verificationSummary,
} from "../src/domain/verifyConstraint.ts";
import type { CouncilRestaurant } from "../src/domain/matchRestaurants.ts";

describe("constraint verification", () => {
  it("writes a natural-language summary with the contact method and person", () => {
    expect(
      verificationSummary({
        result: "meets",
        method: "phone",
        verifiedByName: "Gerald Fishel",
      }),
    ).toBe("Confirmed via Phone by Gerald Fishel.");
    expect(
      verificationSummary({
        result: "does_not_meet",
        method: "email",
        verifiedByName: "Ada",
        notes: "Shared fryer.",
      }),
    ).toBe("Does not meet this constraint, verified via Email by Ada. Shared fryer.");
    expect(
      councilVerificationChat({
        userName: "Gerald Fishel",
        restaurantName: "Noodle Shop",
        constraintLabel: "Gluten free",
        result: "meets",
        method: "phone",
      }),
    ).toBe("Gerald Fishel confirmed Gluten free at Noodle Shop via Phone.");
  });

  it("keeps human verifications when Council runs again", () => {
    const verification = {
      id: "v1",
      result: "meets" as const,
      method: "phone" as const,
      verifiedByUserId: "u1",
      verifiedByName: "Gerald Fishel",
      verifiedAt: "2026-09-20T00:00:00.000Z",
      summary: "Confirmed via Phone by Gerald Fishel.",
    };
    const previous: CouncilRestaurant[] = [
      {
        placeId: "noodles",
        name: "Noodle Shop",
        matched: true,
        constraintChecks: [
          {
            id: "p1",
            label: "Gluten free",
            confirmed: true,
            confirmation: verification.summary,
            verifications: [verification],
          },
        ],
      },
    ];
    const next = mergeRestaurantVerifications(
      [
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          constraintChecks: [{ id: "p1", label: "Gluten free", confirmed: false }],
        },
      ],
      previous,
    );
    expect(next[0]?.constraintChecks?.[0]).toMatchObject({
      confirmed: true,
      confirmation: "Confirmed via Phone by Gerald Fishel.",
      verifications: [verification],
    });
  });

  it("appends a new verification onto a constraint check", () => {
    const updated = applyVerificationToCheck(
      { id: "p1", label: "Kid Friendly", confirmed: false },
      {
        id: "v1",
        result: "unknown",
        method: "in-person",
        verifiedByUserId: "u1",
        verifiedByName: "Ada",
        verifiedAt: "2026-09-20T00:00:00.000Z",
        summary: "Still unknown after checking in person by Ada.",
      },
    );
    expect(updated.confirmed).toBe(false);
    expect(updated.confirmation).toBe("Still unknown after checking in person by Ada.");
    expect(updated.verifications).toHaveLength(1);
  });
});
