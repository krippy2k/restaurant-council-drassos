import { describe, expect, it } from "vitest";
import {
  applyNegotiatorPicks,
  isSafeExplanation,
  mergeExplanations,
  negotiationDraftSchema,
} from "../src/domain/negotiate.ts";

describe("negotiator explanations", () => {
  it("rejects explanations that reveal private money or medical reasons", () => {
    expect(isSafeExplanation("Outdoor seating available")).toBe(true);
    expect(isSafeExplanation("Sarah can't afford this")).toBe(false);
    expect(isSafeExplanation("Conflicts with her budget")).toBe(false);
    expect(isSafeExplanation("Peanut allergy")).toBe(false);
  });

  it("drops unsafe and member-count lines from the model", () => {
    const merged = mergeExplanations(["Strong match for 1/1 members"], [
      "Strong match for 3/4 members",
      "Outdoor seating available",
      "Ada has a dairy issue",
    ]);
    expect(merged).toEqual(["Strong match for 1/1 members", "Outdoor seating available"]);
  });

  it("puts negotiator picks first and keeps remaining restaurants", () => {
    const ranked = applyNegotiatorPicks(
      [
        { placeId: "a", name: "First", matched: true, userScores: [{ userId: "u", userName: "Ada", score: 90 }] },
        { placeId: "b", name: "Second", matched: true, userScores: [{ userId: "u", userName: "Ada", score: 70 }] },
      ],
      {
        picks: [{ candidateId: "b", explanations: ["Quiet enough for conversation"], score: 81 }],
        scores: [{ candidateId: "a", score: 64 }],
      },
    );
    expect(ranked.map((item) => item.placeId)).toEqual(["b", "a"]);
    expect(ranked[0]).toMatchObject({ picked: true, councilScore: 81 });
    expect(ranked[0]?.explanations).toContain("Quiet enough for conversation");
    expect(ranked[1]).toMatchObject({ picked: false, councilScore: 64 });
  });

  it("keeps valid picks when the model uses placeId", () => {
    const parsed = negotiationDraftSchema.parse({
      picks: [{ placeId: "cheap", explanations: "Outdoor seating available" }],
    });
    expect(parsed.picks).toEqual([{ candidateId: "cheap", explanations: ["Outdoor seating available"] }]);
    expect(parsed.scores).toEqual([]);
  });

  it("does not claim all hard constraints are met when gluten-free is unconfirmed", () => {
    const ranked = applyNegotiatorPicks(
      [
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          userScores: [{ userId: "ada", userName: "Ada", score: 80 }],
          constraintChecks: [{ id: "p1", label: "Gluten free", confirmed: false }],
        },
      ],
      { picks: [], scores: [] },
    );
    expect(ranked[0]?.explanations ?? []).not.toContain("Within everyone's hard constraints");
  });

  it("does not let the model claim hard constraints when gluten-free is unconfirmed", () => {
    const ranked = applyNegotiatorPicks(
      [
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          userScores: [{ userId: "ada", userName: "Ada", score: 80 }],
          constraintChecks: [{ id: "p1", label: "Gluten free", confirmed: false }],
        },
      ],
      {
        picks: [
          {
            candidateId: "noodles",
            explanations: ["Within everyone's hard constraints", "Outdoor seating available"],
            score: 88,
          },
        ],
        scores: [],
      },
    );
    expect(ranked[0]?.explanations ?? []).not.toContain("Within everyone's hard constraints");
    expect(ranked[0]?.explanations).toContain("Outdoor seating available");
  });

  it("claims all hard constraints only after every public hard check is confirmed", () => {
    const ranked = applyNegotiatorPicks(
      [
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          userScores: [{ userId: "ada", userName: "Ada", score: 90 }],
          constraintChecks: [
            { id: "p1", label: "Gluten free", confirmed: true, confirmation: "Confirmed by the menu" },
          ],
        },
      ],
      { picks: [], scores: [] },
    );
    expect(ranked[0]?.explanations).toContain("Within everyone's hard constraints");
  });
});
