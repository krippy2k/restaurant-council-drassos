import { describe, expect, it } from "vitest";
import {
  assessDietaryEvidence,
  dietaryRequirementForPreference,
  extractDietarySignals,
  scoreFromDietaryAssessment,
} from "../src/domain/dietary.ts";
import { attachDietaryAssessments, setDietaryLookup } from "../src/dietaryLookup.ts";
import { scorePlaceForUser } from "../src/domain/matchRestaurants.ts";
import { afterEach } from "vitest";

describe("dietary lookup", () => {
  afterEach(() => {
    setDietaryLookup(undefined);
  });

  it("does not treat a dish name as dairy-free proof", () => {
    expect(extractDietarySignals("The grilled salmon with vegetables was excellent.", "dairy-free")).toEqual([]);
  });

  it("maps a gluten-free preference and scores from website evidence", async () => {
    expect(
      dietaryRequirementForPreference({
        id: "p1",
        eventId: "e1",
        userId: "ada",
        category: "dietary",
        visibility: "PUBLIC",
        priority: "HARD",
        value: { label: "Gluten free", type: "gluten-free" },
        createdAt: "",
        updatedAt: "",
      }),
    ).toBe("gluten-free");

    setDietaryLookup(async (restaurants, requirements) =>
      restaurants.map((restaurant) => ({
        ...restaurant,
        dietaryAssessments: requirements.map((requirement) =>
          assessDietaryEvidence({
            restaurantId: restaurant.placeId,
            requirement,
            evidence: [
              {
                id: "evd",
                sourceType: "official-menu",
                excerpt: "Gluten-free dishes are marked on the menu.",
                supports: "supports",
                reliability: "high",
              },
            ],
          }),
        ),
      })),
    );

    const [analyzed] = await attachDietaryAssessments(
      [{ placeId: "noodles", name: "Noodle Shop" }],
      [
        {
          id: "p1",
          eventId: "e1",
          userId: "ada",
          category: "dietary",
          visibility: "PUBLIC",
          priority: "HARD",
          value: { label: "Gluten free", type: "gluten-free" },
          createdAt: "",
          updatedAt: "",
        },
      ],
    );
    expect(analyzed?.dietaryAssessments?.[0]?.status).toBe("confirmed");
    expect(
      scorePlaceForUser(analyzed!, [
        {
          id: "p1",
          eventId: "e1",
          userId: "ada",
          category: "dietary",
          visibility: "PUBLIC",
          priority: "HARD",
          value: { label: "Gluten free", type: "gluten-free" },
          createdAt: "",
          updatedAt: "",
        },
      ]),
    ).toBe(100);
  });

  it("treats missing evidence as uncertain, not a no", () => {
    expect(
      scoreFromDietaryAssessment(
        assessDietaryEvidence({ restaurantId: "x", requirement: "dairy-free", evidence: [] }),
      ),
    ).toBe(50);
  });

  it("treats official contradiction as unsupported", () => {
    const assessment = assessDietaryEvidence({
      restaurantId: "x",
      requirement: "gluten-free",
      evidence: [
        {
          id: "evd",
          sourceType: "official-website",
          excerpt: "We cannot accommodate gluten-free preparation.",
          supports: "contradicts",
          reliability: "high",
        },
      ],
    });
    expect(assessment.status).toBe("unsupported");
    expect(scoreFromDietaryAssessment(assessment)).toBe(0);
  });
});
