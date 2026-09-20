import { describe, expect, it } from "vitest";
import { addEventChatMessage, listEventChat } from "../src/chat.ts";

describe("event chat", () => {
  it("stores messages for an event in order", async () => {
    const eventId = crypto.randomUUID();
    const first = await addEventChatMessage({
      id: crypto.randomUUID(),
      eventId,
      userId: "user_ada",
      body: "Hello table",
      createdAt: "2026-09-19T21:00:00.000Z",
    });
    await addEventChatMessage({
      id: crypto.randomUUID(),
      eventId,
      userId: "user_pat",
      body: "Hi Ada",
      createdAt: "2026-09-19T21:01:00.000Z",
    });

    const messages = await listEventChat(eventId, "user_ada");
    expect(messages.map((item) => item.body)).toEqual(["Hello table", "Hi Ada"]);
    expect(messages[0]).toMatchObject({ id: first.id, mine: true });
    expect(messages[1]?.mine).toBe(false);
  });
});
