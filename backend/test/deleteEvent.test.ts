import { afterEach, describe, expect, it } from "vitest";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { eventFromCommand } from "../src/domain/commands.ts";
import { getEventById, saveEvent } from "../src/events.ts";
import { deleteEventWorkflow } from "../src/workflows/deleteEvent.ts";

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

describe("delete-event workflow", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("asks for confirmation, then deletes the event", async () => {
    const event = await saveEvent(
      eventFromCommand(
        {
          name: "Delete me",
          locationLabel: "Bamford Park",
          radiusMiles: 5,
          timezone: "America/New_York",
          searchArea: {
            displayName: "Bamford Park",
            latitude: 1,
            longitude: 2,
            radiusMeters: 8047,
            source: "address",
          },
        },
        "user_ada",
        new Date().toISOString(),
        crypto.randomUUID(),
      ),
    );

    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const { runId } = await runtime.start(deleteEventWorkflow, {
      eventId: event.id,
      ownerId: "user_ada",
    });

    const pending = await waitForPending(runtime, runId);
    expect(pending.title).toContain("Delete me");
    expect(pending.metadata).toMatchObject({ event: { id: event.id, name: "Delete me" } });
    expect(await getEventById(event.id)).not.toBeNull();

    await runtime.approve(runId, pending.interactionId);
    const result = await runtime.wait(runId);
    expect(result.status).toBe("COMPLETED");
    expect(result.output).toEqual({ deleted: true, eventId: event.id });
    expect(await getEventById(event.id)).toBeNull();
  }, 20_000);

  it("leaves the event in place when deletion is cancelled", async () => {
    const event = await saveEvent(
      eventFromCommand(
        {
          name: "Keep me",
          locationLabel: "Bamford Park",
          radiusMiles: 5,
          timezone: "America/New_York",
          searchArea: {
            displayName: "Bamford Park",
            latitude: 1,
            longitude: 2,
            radiusMeters: 8047,
            source: "address",
          },
        },
        "user_ada",
        new Date().toISOString(),
        crypto.randomUUID(),
      ),
    );

    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const { runId } = await runtime.start(deleteEventWorkflow, {
      eventId: event.id,
      ownerId: "user_ada",
    });

    const pending = await waitForPending(runtime, runId);
    await runtime.completeInteraction(runId, pending.interactionId, {
      outcome: "rejected",
      reason: "Event deletion was cancelled.",
    });
    const result = await runtime.wait(runId);
    expect(result.status).toBe("FAILED");
    expect(await getEventById(event.id)).not.toBeNull();
  }, 20_000);
});
