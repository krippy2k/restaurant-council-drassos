import { describe, expect, it } from "vitest";
import { listEventChat } from "../src/chat.ts";
import { eventChat } from "../src/tools/chat.ts";
import { saveEvent } from "../src/events.ts";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { afterEach } from "vitest";
import { createCouncilApp } from "../src/app.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

describe("event-chat tool", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("posts as a user or as The Council", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-chat-tool-${crypto.randomUUID()}@example.com`,
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

    const asUser = await eventChat.execute({
      eventId,
      body: "Hello table",
      as: "user",
      userId: host.output!.user.id,
    });
    expect(asUser).toMatchObject({
      eventId,
      userId: host.output!.user.id,
      userName: "Ada Chen",
      body: "Hello table",
    });

    const asCouncil = await eventChat.execute({
      eventId,
      body: "Ada Chen approved Noodle Shop.",
      as: "council",
    });
    expect(asCouncil).toMatchObject({
      eventId,
      userName: "The Council",
      body: "Ada Chen approved Noodle Shop.",
    });

    const messages = await listEventChat(eventId, host.output!.user.id);
    expect(messages.map((item) => ({ userName: item.userName, body: item.body, mine: item.mine }))).toEqual([
      { userName: "Ada Chen", body: "Hello table", mine: true },
      { userName: "The Council", body: "Ada Chen approved Noodle Shop.", mine: false },
    ]);
  });
});
