import { afterEach, describe, expect, it } from "vitest";
import { ScriptedModelProvider } from "@drassos/node";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import {
  draftsFromAgentOutput,
  inferPreferenceVisibility,
  preferenceDraftSchema,
} from "../src/domain/preferences.ts";
import { saveEvent } from "../src/events.ts";
import { addJoinedMember } from "../src/members.ts";
import { listVisiblePreferences } from "../src/preferences.ts";
import { addEventPreferencesWorkflow } from "../src/workflows/addEventPreferences.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

describe("preference draft parsing", () => {
  it("treats keep-it-quiet language as private and fills an empty model result from the note", () => {
    expect(inferPreferenceVisibility("Peanut allergy, keep it quiet.")).toBe("PRIVATE");
    const fromEmpty = draftsFromAgentOutput({ constraints: [] }, "I can't eat gluten. Keep this private.");
    expect(fromEmpty).toEqual([
      expect.objectContaining({
        category: "freeform",
        visibility: "PRIVATE",
        priority: "HARD",
      }),
    ]);
  });

  it("accepts preferences aliases, lowercase visibility, and top-level privacy", () => {
    const parsed = preferenceDraftSchema.parse({
      visibility: "private",
      preferences: [
        {
          category: "diet",
          label: "Gluten free",
          priority: "required",
          value: { type: "gluten-free" },
        },
      ],
    });
    expect(parsed.constraints).toEqual([
      expect.objectContaining({
        category: "dietary",
        label: "Gluten free",
        priority: "HARD",
        visibility: "PRIVATE",
      }),
    ]);
  });
});


describe("add-event-preferences workflow", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("saves hard public constraints and hides another person's private ones", async () => {
    const app = createCouncilApp({
      models: {
        openai: new ScriptedModelProvider(
          [
            {
              output: {
                constraints: [
                  {
                    category: "dietary",
                    label: "Gluten free",
                    priority: "HARD",
                    visibility: "PUBLIC",
                    value: { type: "gluten-free" },
                  },
                  {
                    category: "price",
                    label: "Under $30",
                    priority: "HARD",
                    visibility: "PUBLIC",
                    value: { maxDollars: 30 },
                  },
                ],
              },
            },
            {
              output: {
                constraints: [],
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

    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const guest = await runtime.execute(registerUserWorkflow, {
      name: "Pat Rivera",
      email: `guest-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: host.output!.user.id,
      name: "Friday dinner",
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await addJoinedMember({
      eventId: event.id,
      userId: guest.output!.user.id,
      joinedAt: new Date().toISOString(),
    });

    const publicPrefs = await runtime.execute(addEventPreferencesWorkflow, {
      eventId: event.id,
      userId: host.output!.user.id,
      message: "I can't eat gluten and the meal needs to stay under $30.",
    });
    expect(publicPrefs.status).toBe("COMPLETED");
    expect(publicPrefs.output?.preferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "dietary",
          priority: "HARD",
          visibility: "PUBLIC",
          value: expect.objectContaining({ type: "gluten-free", label: "Gluten free" }),
        }),
        expect.objectContaining({
          category: "price",
          priority: "HARD",
          visibility: "PUBLIC",
          value: expect.objectContaining({ maxDollars: 30 }),
        }),
      ]),
    );

    const privatePrefs = await runtime.execute(addEventPreferencesWorkflow, {
      eventId: event.id,
      userId: guest.output!.user.id,
      message: "Peanut allergy, keep it quiet.",
    });
    expect(privatePrefs.status).toBe("COMPLETED");
    expect(privatePrefs.output?.preferences[0]).toMatchObject({
      visibility: "PRIVATE",
      priority: "HARD",
      userId: guest.output!.user.id,
    });
    expect(privatePrefs.output?.preferences[0]?.value).toEqual(
      expect.objectContaining({ label: expect.stringMatching(/Peanut allergy/i) }),
    );

    const hostView = await listVisiblePreferences(event.id, host.output!.user.id);
    expect(hostView.map((item) => item.label)).toEqual(expect.arrayContaining(["Gluten free", "Under $30"]));
    expect(hostView.some((item) => /Peanut allergy/i.test(item.label))).toBe(false);

    const guestView = await listVisiblePreferences(event.id, guest.output!.user.id);
    expect(guestView.map((item) => item.label)).toEqual(expect.arrayContaining(["Gluten free", "Under $30"]));
    expect(guestView.some((item) => /Peanut allergy/i.test(item.label) && item.mine)).toBe(true);
  }, 20_000);
});
