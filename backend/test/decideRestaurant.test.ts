import { afterEach, describe, expect, it } from "vitest";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import {
  applyRestaurantDecision,
  councilDecisionChat,
  mergeRestaurantDecisions,
  scoreFromDecision,
} from "../src/domain/restaurantDecision.ts";
import { saveEvent } from "../src/events.ts";
import { listEventChat } from "../src/chat.ts";
import { saveRestaurantSearch } from "../src/restaurants.ts";
import { decideRestaurantWorkflow } from "../src/workflows/decideRestaurant.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

describe("restaurant decisions", () => {
  it("adjusts a personal score from the original match", () => {
    expect(scoreFromDecision(72, "prefer")).toBe(82);
    expect(scoreFromDecision(72, "dislike")).toBe(62);
    expect(scoreFromDecision(72, "reject")).toBe(0);
    expect(scoreFromDecision(72, "approve")).toBe(100);
    const preferred = applyRestaurantDecision({
      restaurant: {
        placeId: "noodles",
        name: "Noodle Shop",
        matched: true,
        userScores: [{ userId: "ada", userName: "Ada", score: 72 }],
        constraintChecks: [{ id: "p1", label: "Gluten free", confirmed: false }],
      },
      userId: "ada",
      userName: "Ada",
      decision: "prefer",
      nowIso: "2026-09-20T00:00:00.000Z",
    });
    expect(preferred.userScores?.[0]?.score).toBe(82);
    const disliked = applyRestaurantDecision({
      restaurant: preferred,
      userId: "ada",
      userName: "Ada",
      decision: "dislike",
      nowIso: "2026-09-20T00:00:01.000Z",
    });
    expect(disliked.userScores?.[0]?.score).toBe(62);
    expect(councilDecisionChat({ userName: "Ada Chen", restaurantName: "Noodle Shop", decision: "approve" })).toBe(
      "Ada Chen approved Noodle Shop.",
    );
  });

  it("reapplies stored decisions after Council scores again", () => {
    const merged = mergeRestaurantDecisions(
      [
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          userScores: [{ userId: "ada", userName: "Ada", score: 70 }],
        },
      ],
      [
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          decisions: [
            {
              userId: "ada",
              userName: "Ada",
              decision: "prefer",
              baseScore: 60,
              at: "2026-09-20T00:00:00.000Z",
            },
          ],
        },
      ],
    );
    expect(merged[0]?.userScores?.[0]).toMatchObject({ score: 80, decision: "prefer" });
  });
});

describe("decide-restaurant workflow", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("saves approve, reject, prefer, and dislike through the workflow", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-decide-${Date.now()}@example.com`,
      password: "secret123",
    });
    const eventId = crypto.randomUUID();
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
      status: "draft",
      createdAt: "",
      updatedAt: "",
    });
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          userScores: [{ userId: host.output!.user.id, userName: "Ada Chen", score: 70 }],
          constraintChecks: [{ id: "p1", label: "Gluten free", confirmed: false }],
        },
      ],
    });
    const preferred = await runtime.execute(decideRestaurantWorkflow, {
      eventId,
      placeId: "noodles",
      userId: host.output!.user.id,
      decision: "prefer",
    });
    expect(preferred.output?.restaurant.userScores?.[0]?.score).toBe(80);
    const rejected = await runtime.execute(decideRestaurantWorkflow, {
      eventId,
      placeId: "noodles",
      userId: host.output!.user.id,
      decision: "reject",
    });
    expect(rejected.output?.restaurant.userScores?.[0]?.score).toBe(0);
    const approved = await runtime.execute(decideRestaurantWorkflow, {
      eventId,
      placeId: "noodles",
      userId: host.output!.user.id,
      decision: "approve",
    });
    expect(approved.output?.restaurant.userScores?.[0]?.score).toBe(100);
    const chat = await listEventChat(eventId, host.output!.user.id);
    expect(chat.map((item) => item.body)).toEqual([
      "Ada Chen prefers Noodle Shop.",
      "Ada Chen rejected Noodle Shop.",
      "Ada Chen approved Noodle Shop.",
    ]);
    expect(chat.every((item) => item.userName === "The Council")).toBe(true);
  });
});
