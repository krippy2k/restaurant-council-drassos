import { afterEach, describe, expect, it } from "vitest";
import { ScriptedModelProvider } from "@drassos/node";
import type { ModelProvider, ModelRequest, ModelResponse } from "@drassos/core";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { listEventChat } from "../src/chat.ts";
import { parseAgentChatRequest, replyFromAgentOutput } from "../src/domain/agentChat.ts";
import { saveEvent } from "../src/events.ts";
import { saveRestaurantSearch } from "../src/restaurants.ts";
import { eventChat } from "../src/tools/chat.ts";
import { setMenuPageFetcher } from "../src/tools/checkMenuItem.ts";
import { agentChatRequestWorkflow, councilChatAgent } from "../src/workflows/agentChat.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

describe("agent chat mention parsing", () => {
  it("detects messages that begin with @council or @agent", () => {
    expect(parseAgentChatRequest("@agent hours on Friday?")).toEqual({
      mention: "@agent",
      query: "hours on Friday?",
    });
    expect(parseAgentChatRequest("  @Council, does Noodle Shop have pad thai?")).toEqual({
      mention: "@council",
      query: "does Noodle Shop have pad thai?",
    });
    expect(parseAgentChatRequest("@AGENT")).toEqual({ mention: "@agent", query: "" });
  });

  it("ignores mentions that are not at the start of the message", () => {
    expect(parseAgentChatRequest("hello @agent")).toBeUndefined();
    expect(parseAgentChatRequest("please ask @council about hours")).toBeUndefined();
    expect(parseAgentChatRequest("@councilor check hours")).toBeUndefined();
  });

  it("turns agent output into a chat reply", () => {
    expect(replyFromAgentOutput({ reply: "Open until 9." })).toBe("Open until 9.");
    expect(replyFromAgentOutput("Plain answer")).toBe("Plain answer");
    expect(replyFromAgentOutput({})).toMatch(/couldn't finish/i);
    expect(replyFromAgentOutput({ restaurantName: "Baoshi Food Hall + Bar", hoursForDay: "Saturday: 11:30 AM – 1:00 AM" })).toBe(
      "Baoshi Food Hall + Bar: Saturday: 11:30 AM – 1:00 AM.",
    );
    expect(
      replyFromAgentOutput({ found: true, restaurantName: "Baoshi Food Hall + Bar", item: "french fries" }),
    ).toBe("Baoshi Food Hall + Bar lists french fries.");
    expect(
      replyFromAgentOutput({ found: false, restaurantName: "Baoshi Food Hall + Bar", item: "french fries" }),
    ).toMatch(/could not confirm french fries/i);
  });
});

describe("agent-chat-request workflow", () => {
  const runtimes: TestRuntime[] = [];

  it("registers the chat agent with hours and menu tools", () => {
    const app = createCouncilApp({ models: {} });
    expect(app.workflows?.some((item) => item.name === "agent-chat-request")).toBe(true);
    expect(app.agents?.some((item) => item.name === "council-chat")).toBe(true);
    expect(councilChatAgent.tools?.some((tool) => "name" in tool && tool.name === "lookup-restaurant-hours")).toBe(
      true,
    );
    expect(councilChatAgent.tools?.some((tool) => "name" in tool && tool.name === "check-menu-item")).toBe(true);
    expect(councilChatAgent.instructions).toMatch(/hours-only question/i);
    expect(councilChatAgent.instructions).not.toMatch(/do not call lookup-restaurant-hours/i);
  });

  afterEach(async () => {
    setMenuPageFetcher(undefined);
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("posts a council reply after the agent interprets an @agent request", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: new ScriptedModelProvider(
            [{ output: { reply: "Noodle Shop is a strong pick for the group." } }],
            "openai",
          ),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const { eventId, userId } = await seedChatEvent(runtime);
    await eventChat.execute({
      eventId,
      userId,
      body: "@agent which restaurant should we pick?",
      as: "user",
    });

    const result = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId,
      message: "@agent which restaurant should we pick?",
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.reply).toBe("Noodle Shop is a strong pick for the group.");

    const messages = await listEventChat(eventId, userId);
    expect(messages.map((item) => ({ userName: item.userName, body: item.body }))).toEqual([
      { userName: "Ada Chen", body: "@agent which restaurant should we pick?" },
      { userName: "The Council", body: "Noodle Shop is a strong pick for the group." },
    ]);
  }, 20_000);

  it("lets the chat agent call check-menu-item before answering", async () => {
    setMenuPageFetcher(async (url) => (url.endsWith("/menu") ? "Kids Mini Burger $8." : "Home"));
    const eventId = crypto.randomUUID();
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: new ScriptedModelProvider(
            [
              {
                toolCalls: [
                  {
                    id: "1",
                    name: "check-menu-item",
                    arguments: { eventId, placeId: "noodles", item: "kids burger" },
                  },
                ],
              },
              { output: { reply: "Yes — Noodle Shop lists a kids burger." } },
            ],
            "openai",
          ),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const { userId } = await seedChatEvent(runtime, eventId);
    const result = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId,
      message: "@council does Noodle Shop have a kids burger?",
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.reply).toBe("Yes — Noodle Shop lists a kids burger.");
    const messages = await listEventChat(eventId, userId);
    expect(messages.at(-1)).toMatchObject({
      userName: "The Council",
      body: "Yes — Noodle Shop lists a kids burger.",
    });
  }, 20_000);

  it("rejects a message that is not an agent chat request", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const { eventId, userId } = await seedChatEvent(runtime);
    const result = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId,
      message: "Hello table",
    });
    expect(result.status).toBe("FAILED");
    expect(result.error?.message).toMatch(/@council or @agent/i);
  });

  it("lets the chat agent look up Cooper's Hawk hours without mentioning the menu", async () => {
    const eventId = crypto.randomUUID();
    const placeId = "ChIJjS1x3ASm2YgRmI_a_Wp8Mqc";
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: toolFollowingHoursModel(),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-coopers-sat-${crypto.randomUUID()}@example.com`,
      password: "secret123",
    });
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
      date: "2026-09-23",
      timezone: "America/New_York",
      status: "draft",
      createdAt: "",
      updatedAt: "",
    });
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId,
          name: "Cooper’s Hawk Winery & Restaurant",
          matched: true,
          hours: [
            "Monday: 11:00 AM – 9:00 PM",
            "Wednesday: 11:00 AM – 9:00 PM",
            "Saturday: 10:00 AM – 10:00 PM",
          ],
        },
      ],
    });

    const result = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId: host.output!.user.id,
      message: "@council what are the hours for Cooper's Hawk this Saturday?",
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.reply).toMatch(/Saturday: 10:00 AM/i);
    expect(result.output?.reply).not.toMatch(/Bruschetta|Piccata|Chocolate Cake|menu/i);
    expect(result.output?.reply).not.toMatch(/Wednesday/i);
  }, 20_000);

  it("remembers Cooper's Hawk so a follow-up can omit the restaurant name", async () => {
    setMenuPageFetcher(async (url) => (url.endsWith("/menu") ? "Bruschetta $12. Chicken Piccata $24." : "Home"));
    const eventId = crypto.randomUUID();
    const placeId = "ChIJjS1x3ASm2YgRmI_a_Wp8Mqc";
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: memoryFollowUpModel(),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-memory-${crypto.randomUUID()}@example.com`,
      password: "secret123",
    });
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
      date: "2026-09-23",
      timezone: "America/New_York",
      status: "draft",
      createdAt: "",
      updatedAt: "",
    });
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId,
          name: "Cooper’s Hawk Winery & Restaurant",
          matched: true,
          website: "https://coopers.example",
          hours: ["Saturday: 10:00 AM – 10:00 PM"],
        },
        {
          placeId: "noodles",
          name: "Noodle Shop",
          matched: true,
          website: "https://noodles.example",
          hours: ["Friday: 5:00 PM – 10:00 PM"],
        },
      ],
    });

    const hours = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId: host.output!.user.id,
      message: "@council what are the hours for Cooper's Hawk this Saturday?",
    });
    expect(hours.status).toBe("COMPLETED");

    const followUp = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId: host.output!.user.id,
      message: "@council do they have bruschetta?",
    });
    expect(followUp.status).toBe("COMPLETED");
    expect(followUp.output?.reply).toMatch(/Bruschetta/i);
    expect(followUp.output?.reply).not.toMatch(/Noodle Shop/i);
  }, 20_000);

  it("looks up Baoshi hours for next Saturday through the agent", async () => {
    const eventId = crypto.randomUUID();
    const placeId = "ChIJY5VwE8ep2YgRNf_tSHXBmtU";
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: toolFollowingHoursModel(),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-baoshi-${crypto.randomUUID()}@example.com`,
      password: "secret123",
    });
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
      date: "2026-09-23",
      timezone: "America/New_York",
      status: "draft",
      createdAt: "",
      updatedAt: "",
    });
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId,
          name: "Baoshi Food Hall + Bar",
          matched: true,
          hours: [
            "Friday: 11:30 AM – 1:00 AM",
            "Saturday: 11:30 AM – 1:00 AM",
            "Sunday: 11:30 AM – 12:00 AM",
          ],
        },
      ],
    });

    const result = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId: host.output!.user.id,
      message: "@agent What are the hours for baoshi next Saturday?",
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.reply).not.toMatch(/couldn't finish/i);
    expect(result.output?.reply).toMatch(/Baoshi/i);
    expect(result.output?.reply).toMatch(/Saturday: 11:30 AM/i);
  }, 20_000);

  it("checks a Baoshi menu item without asking to convene Council", async () => {
    setMenuPageFetcher(async (url) => (url.includes("baoshi") ? "French fries $6. Dumplings $12." : "Home"));
    const eventId = crypto.randomUUID();
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: toolFollowingMenuModel(),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-baoshi-fries-${crypto.randomUUID()}@example.com`,
      password: "secret123",
    });
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
      date: "2026-09-23",
      timezone: "America/New_York",
      status: "draft",
      createdAt: "",
      updatedAt: "",
    });
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId: "ChIJY5VwE8ep2YgRNf_tSHXBmtU",
          name: "Baoshi Food Hall + Bar",
          matched: true,
          website: "https://www.baoshifoodhall.com/",
        },
      ],
    });

    const result = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId: host.output!.user.id,
      message: "@agent does baoshi have french fries?",
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.reply).not.toMatch(/convene/i);
    expect(result.output?.reply).toMatch(/french fries/i);
  }, 20_000);

  it("answers a Baoshi fries question from the menu tool even if the agent keeps calling tools", async () => {
    setMenuPageFetcher(async (url) => (url.includes("baoshi") ? "French fries $6. Dumplings $12." : "Home"));
    const eventId = crypto.randomUUID();
    const runtime = await createTestRuntime({
      app: createCouncilApp({
        models: {
          openai: loopingMenuModel(),
        },
      }),
      allowReplace: true,
    });
    runtimes.push(runtime);
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-baoshi-loop-${crypto.randomUUID()}@example.com`,
      password: "secret123",
    });
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
      date: "2026-09-23",
      timezone: "America/New_York",
      status: "draft",
      createdAt: "",
      updatedAt: "",
    });
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId: "ChIJY5VwE8ep2YgRNf_tSHXBmtU",
          name: "Baoshi Food Hall + Bar",
          matched: true,
          website: "https://www.baoshifoodhall.com/",
        },
      ],
    });

    const result = await runtime.execute(agentChatRequestWorkflow, {
      eventId,
      userId: host.output!.user.id,
      message: "@agent does baoshi have french fries?",
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.output?.reply).not.toMatch(/couldn't finish/i);
    expect(result.output?.reply).toMatch(/Baoshi/i);
    expect(result.output?.reply).toMatch(/french fries/i);
  }, 20_000);

  async function seedChatEvent(runtime: TestRuntime, eventId = crypto.randomUUID()) {
    const host = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email: `ada-agent-chat-${crypto.randomUUID()}@example.com`,
      password: "secret123",
    });
    await saveEvent({
      id: eventId,
      ownerId: host.output!.user.id,
      name: "Dinner",
      date: "2026-09-25",
      timezone: "America/New_York",
      status: "draft",
      createdAt: "",
      updatedAt: "",
    });
    const placeId = "noodles";
    await saveRestaurantSearch({
      eventId,
      searchedAt: new Date().toISOString(),
      restaurants: [
        {
          placeId,
          name: "Noodle Shop",
          matched: true,
          website: "https://noodles.example",
          hours: ["Friday: 5:00 PM – 10:00 PM"],
        },
      ],
    });
    return { eventId, userId: host.output!.user.id, placeId };
  }
});

function memoryFollowUpModel(): ModelProvider {
  return {
    name: "openai",
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const toolMessage = [...request.messages].reverse().find((item) => item.role === "tool");
      if (toolMessage?.content) {
        const parsed = JSON.parse(toolMessage.content) as {
          restaurantName?: string;
          hoursForDay?: string;
          hours?: string[];
          found?: boolean;
          item?: string;
          excerpt?: string;
        };
        if (parsed.item) {
          return {
            output: {
              reply: parsed.found
                ? `${parsed.restaurantName} lists ${parsed.item}.`
                : `I could not confirm ${parsed.item} at ${parsed.restaurantName}.`,
            },
          };
        }
        const line = parsed.hoursForDay ?? parsed.hours?.join("; ");
        return { output: { reply: `${parsed.restaurantName}: ${line}.` } };
      }
      const user = request.messages.find((item) => item.role === "user");
      const input = JSON.parse(String(user?.content ?? "{}")) as {
        eventId?: string;
        message?: string;
        query?: string;
        restaurants?: Array<{ placeId: string; name: string }>;
        rememberedRestaurants?: Array<{ placeId: string; name: string }>;
      };
      const text = `${input.message ?? ""} ${input.query ?? ""}`;
      if (/bruschetta|have they|do they/i.test(text) && !/cooper/i.test(text)) {
        const remembered = input.rememberedRestaurants?.[0];
        expect(remembered?.name).toMatch(/Cooper/i);
        expect(remembered?.placeId).not.toBe("noodles");
        return {
          toolCalls: [
            {
              id: "menu-1",
              name: "check-menu-item",
              arguments: {
                eventId: String(input.eventId ?? ""),
                placeId: remembered?.placeId ?? "",
                item: "bruschetta",
              },
            },
          ],
        };
      }
      const weekday = /saturday/i.test(text) ? "Saturday" : undefined;
      const restaurant =
        input.restaurants?.find((item) => /cooper/i.test(item.name)) ?? input.restaurants?.[0];
      return {
        toolCalls: [
          {
            id: "hours-1",
            name: "lookup-restaurant-hours",
            arguments: {
              eventId: String(input.eventId ?? ""),
              placeId: restaurant?.placeId ?? "Cooper's Hawk",
              ...(weekday ? { weekday } : {}),
            },
          },
        ],
      };
    },
  };
}

function toolFollowingHoursModel(): ModelProvider {
  return {
    name: "openai",
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const toolMessage = [...request.messages].reverse().find((item) => item.role === "tool");
      if (toolMessage?.content) {
        const parsed = JSON.parse(toolMessage.content) as {
          restaurantName?: string;
          hoursForDay?: string;
          hours?: string[];
        };
        const line = parsed.hoursForDay ?? parsed.hours?.join("; ");
        return { output: { reply: `${parsed.restaurantName}: ${line}.` } };
      }
      const user = request.messages.find((item) => item.role === "user");
      const input = JSON.parse(String(user?.content ?? "{}")) as {
        eventId?: string;
        message?: string;
        query?: string;
        restaurants?: Array<{ placeId: string; name: string }>;
        rememberedRestaurants?: Array<{ placeId: string; name: string }>;
      };
      const text = `${input.message ?? ""} ${input.query ?? ""}`;
      expect(text, "hours questions should not be answered from a menu tool").toMatch(/hours/i);
      const weekday = /saturday/i.test(text) ? (/next/i.test(text) ? "next Saturday" : "Saturday") : undefined;
      const restaurant =
        input.restaurants?.find((item) => /cooper|baoshi/i.test(item.name)) ??
        input.rememberedRestaurants?.[0] ??
        input.restaurants?.[0];
      return {
        toolCalls: [
          {
            id: "hours-1",
            name: "lookup-restaurant-hours",
            arguments: {
              eventId: String(input.eventId ?? ""),
              placeId: /baoshi/i.test(text) ? "baoshi" : (restaurant?.placeId ?? "Cooper's Hawk"),
              ...(weekday ? { weekday } : {}),
            },
          },
        ],
      };
    },
  };
}

function toolFollowingMenuModel(): ModelProvider {
  return {
    name: "openai",
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const toolMessage = [...request.messages].reverse().find((item) => item.role === "tool");
      if (toolMessage?.content) {
        const parsed = JSON.parse(toolMessage.content) as {
          found?: boolean;
          restaurantName?: string;
          item?: string;
        };
        expect(parsed.restaurantName, "menu tool should resolve baoshi to the listing").toMatch(/Baoshi/i);
        return {
          output: {
            reply: parsed.found
              ? `Yes — ${parsed.restaurantName} lists ${parsed.item}.`
              : `I could not confirm ${parsed.item} at ${parsed.restaurantName}.`,
          },
        };
      }
      const user = request.messages.find((item) => item.role === "user");
      const input = JSON.parse(String(user?.content ?? "{}")) as {
        eventId?: string;
        message?: string;
        query?: string;
      };
      const text = `${input.message ?? ""} ${input.query ?? ""}`;
      expect(text).toMatch(/french fries/i);
      return {
        toolCalls: [
          {
            id: "menu-1",
            name: "check-menu-item",
            arguments: {
              eventId: String(input.eventId ?? ""),
              placeId: "baoshi",
              item: "french fries",
            },
          },
        ],
      };
    },
  };
}

function loopingMenuModel(): ModelProvider {
  let calls = 0;
  return {
    name: "openai",
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const user = request.messages.find((item) => item.role === "user");
      const input = JSON.parse(String(user?.content ?? "{}")) as { eventId?: string };
      calls += 1;
      return {
        toolCalls: [
          {
            id: `menu-loop-${calls}`,
            name: "check-menu-item",
            arguments: {
              eventId: String(input.eventId ?? ""),
              placeId: "baoshi",
              item: "french fries",
            },
          },
        ],
      };
    },
  };
}
