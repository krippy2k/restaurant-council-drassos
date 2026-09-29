import { describe, expect, it } from "vitest";
import { applyPersonalScore, inputForPersonalAgent } from "../src/domain/personalScore.ts";
import type { CouncilRestaurant } from "../src/domain/matchRestaurants.ts";
import type { Preference } from "../src/domain/types.ts";

const ada = { id: "ada", name: "Ada" };
const bob = { id: "bob", name: "Bob" };

const restaurants: CouncilRestaurant[] = [
  { placeId: "tacos", name: "Taco Stand", matched: true, userScores: [{ userId: "ada", userName: "Ada", score: 10 }] },
  { placeId: "noodles", name: "Noodle Shop", matched: true, userScores: [{ userId: "ada", userName: "Ada", score: 40 }] },
];

const preferences: Preference[] = [
  {
    id: "p1",
    eventId: "e1",
    userId: "ada",
    category: "cuisine",
    visibility: "PUBLIC",
    priority: "HIGH",
    value: { label: "Mexican", type: "mexican" },
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "p2",
    eventId: "e1",
    userId: "bob",
    category: "dietary",
    visibility: "PRIVATE",
    priority: "HARD",
    value: { label: "Peanut allergy", type: "peanut" },
    createdAt: "",
    updatedAt: "",
  },
];

describe("personal agent scoring", () => {
  it("builds an input that contains only that person's preferences", () => {
    const adaInput = inputForPersonalAgent(ada, preferences, restaurants);
    const bobInput = inputForPersonalAgent(bob, preferences, restaurants);
    expect(adaInput.preferences.map((item) => item.label)).toEqual(["Mexican"]);
    expect(bobInput.preferences.map((item) => item.label)).toEqual(["Peanut allergy"]);
    expect(JSON.stringify(adaInput)).not.toContain("Peanut");
    expect(JSON.stringify(bobInput)).not.toContain("Mexican");
    expect(adaInput.candidates.map((item) => item.placeId)).toEqual(["tacos", "noodles"]);
  });

  it("replaces only the scored places for that person", () => {
    const scored = applyPersonalScore(restaurants, ada, {
      scores: [{ placeId: "tacos", score: 92 }],
    });
    expect(scored[0]?.userScores?.[0]).toMatchObject({ userId: "ada", score: 92 });
    expect(scored[1]?.userScores?.[0]).toMatchObject({ userId: "ada", score: 40 });
  });
});
