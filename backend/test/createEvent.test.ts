import { afterEach, describe, expect, it } from "vitest";
import { ScriptedModelProvider } from "@drassos/node";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { createEventWorkflow } from "../src/workflows/createEvent.ts";

async function waitForPending(runtime: TestRuntime, runId: string) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const pending = await runtime.getPendingInteractions(runId);
    if (pending.length > 0) {
      return pending[0]!;
    }
    const run = await runtime.getRun(runId);
    if (run && (run.status === "FAILED" || run.status === "COMPLETED" || run.status === "CANCELLED")) {
      throw new Error(`Run ${run.status}: ${run.error?.message ?? JSON.stringify(run.output)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for confirmation.");
}

describe("create-event workflow", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it(
    "interprets a message into a command, applies a change request, then creates the event",
    async () => {
    const app = createCouncilApp({
      models: {
        openai: new ScriptedModelProvider(
          [
            {
              output: {
                name: "Sunday tasting",
                locationLabel: "Bamford Park, Broward County",
                radiusMiles: 10,
                date: "2026-09-19",
                constraints: [{ type: "kid-friendly", strength: "required" }],
              },
            },
            {
              output: {
                name: "Sunday tasting",
                locationLabel: "Bamford Park, Broward County",
                radiusMiles: 5,
                date: "2026-09-19",
              },
            },
          ],
          "openai",
        ),
      },
    });
    const runtime = await createTestRuntime({
      app,
      allowReplace: true,
    });
    runtimes.push(runtime);

    const { runId } = await runtime.start(createEventWorkflow, {
      message: "Find somewhere within 10 miles of Bamford Park on Saturday at 3pm.",
      ownerId: "user_ada",
      timezone: "America/New_York",
    });

    const first = await waitForPending(runtime, runId);
    expect(first.metadata).toMatchObject({
      command: {
        name: "Sunday tasting",
        locationLabel: "Bamford Park, Broward County",
        radiusMiles: 10,
        constraints: [{ type: "kid-friendly", label: "Kid Friendly" }],
      },
    });

    await runtime.completeInteraction(runId, first.interactionId, {
      outcome: "changes_requested",
      feedback: "Make the radius 5 miles.",
    });

    const second = await waitForPending(runtime, runId);
    expect(second.metadata).toMatchObject({
      command: {
        radiusMiles: 5,
        searchArea: { displayName: "Bamford Park, Broward County" },
      },
    });

    await runtime.approve(runId, second.interactionId);
    const result = await runtime.wait(runId);
    expect(result.status).toBe("COMPLETED");
    expect(result.output).toMatchObject({
      ownerId: "user_ada",
      name: "Sunday tasting",
      locationLabel: "Bamford Park, Broward County",
      status: "draft",
      searchArea: {
        displayName: "Bamford Park, Broward County",
        radiusMeters: 8047,
      },
    });
    expect(result.output?.id).toEqual(expect.any(String));
  },
  20_000,
);
});
