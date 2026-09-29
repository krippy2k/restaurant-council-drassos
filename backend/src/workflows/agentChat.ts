import { defineAgent, workflow, type ToolDefinition } from "@drassos/core";
import { getAgentChatMemory, rememberAgentChatRestaurants } from "../agentChatMemory.js";
import { listEventChat } from "../chat.js";
import { parseAgentChatRequest, replyFromAgentOutput, type AgentChatReply } from "../domain/agentChat.js";
import { restaurantsMentionedInText } from "../domain/findRestaurant.js";
import { getEventById } from "../events.js";
import { listPendingInvitationsForUser } from "../invitations.js";
import { isEventMember } from "../members.js";
import { getRestaurantsForEvent } from "../restaurants.js";
import { eventChat } from "../tools/chat.js";
import { checkMenuItem } from "../tools/checkMenuItem.js";
import { lookupRestaurantHours } from "../tools/lookupRestaurantHours.js";
import { getUserById } from "../users.js";

export type AgentChatRequestInput = {
  eventId: string;
  userId: string;
  message: string;
};

export type AgentChatRequestOutput = {
  reply: string;
};

const chatHoursTool = rememberRestaurantFromTool(lookupRestaurantHours);
const chatMenuTool = rememberRestaurantFromTool(checkMenuItem);
const lastChatToolResult = new Map<string, unknown>();

export const councilChatAgent = defineAgent({
  name: "council-chat",
  model: "openai:gpt-4o-mini",
  instructions: [
    "You are the Council chat agent for a restaurant event.",
    "Interpret the member's request. Answer only what they asked.",
    "Use tools for restaurant-specific facts. Do not use training knowledge for a specific restaurant.",
    "rememberedRestaurants is conversation memory: the restaurants this chat was last talking about.",
    "If the member uses they, it, this place, or does not name a restaurant, keep using rememberedRestaurants placeIds in tool calls.",
    "If they name a different restaurant from the list, switch to that one.",
    "If they asked about hours or whether a place is open, call lookup-restaurant-hours. Pass eventId, the restaurant placeId from the provided list or rememberedRestaurants, or the name they used (a short unique name such as baoshi is enough). When they named a day, pass weekday as that day name (Saturday), even if they said next Saturday or this Saturday.",
    "For an hours-only question, do not call check-menu-item and do not mention dishes, desserts, or the menu.",
    "If lookup-restaurant-hours returns found false, do not treat that as proof the restaurant is closed.",
    "If they asked whether a dish is on the menu, call check-menu-item once. Pass eventId, the restaurant placeId from the list or rememberedRestaurants, or the name they used (a short unique name such as baoshi is enough). After that tool returns, immediately return {\"reply\":\"...\"}. Do not call check-menu-item again for the same dish.",
    "If check-menu-item returns found false with confidence unknown, do not treat that as proof the dish is absent. Say you could not confirm it from the published menu.",
    "If the restaurants list or rememberedRestaurants is not empty, Council already searched. Never ask the member to convene the Council for a hours or menu question about those restaurants.",
    "Do not invent restaurants. Only if both lists are empty, say Council has not searched yet and ask them to convene the Council.",
    "Do not mention private dietary needs, allergies, or which person requested a constraint.",
    'Return JSON: {"reply":"..."} with a short message for the event chat.',
  ].join(" "),
  tools: [chatMenuTool, chatHoursTool],
  limits: {
    maxTurns: 6,
    maxToolCalls: 3,
    timeout: "60s",
  },
});

export const agentChatRequestWorkflow = workflow<AgentChatRequestInput, AgentChatRequestOutput>(
  "agent-chat-request",
  async (ctx) => {
    const parsed = parseAgentChatRequest(String(ctx.input.message ?? ""));
    if (!parsed) {
      throw Object.assign(new Error("Start the message with @council or @agent."), { status: 400 });
    }

    const user = await ctx.step("authorize", async () => {
      const event = await getEventById(ctx.input.eventId);
      if (!event) {
        throw Object.assign(new Error("Event was not found."), { status: 404 });
      }
      const found = await getUserById(ctx.input.userId);
      if (!found) {
        throw Object.assign(new Error("User was not found."), { status: 404 });
      }
      if (event.ownerId === found.id || (await isEventMember(event.id, found.id))) {
        return { event, user: found };
      }
      const pending = await listPendingInvitationsForUser(found.id, found.email);
      if (pending.some((item) => item.eventId === event.id)) {
        return { event, user: found };
      }
      throw Object.assign(new Error("That event belongs to another host."), { status: 403 });
    });

    const restaurants = await ctx.step("load-restaurants", async () => {
      const search = await getRestaurantsForEvent(ctx.input.eventId);
      return (search?.restaurants ?? []).map((item) => ({
        placeId: item.placeId,
        name: item.name,
        address: item.address,
        website: item.website,
      }));
    });

    const recentChat = await ctx.step("load-chat", async () => {
      const messages = await listEventChat(ctx.input.eventId, ctx.input.userId);
      return messages.slice(-12).map((item) => ({
        userName: item.userName,
        body: item.body,
      }));
    });

    const query = parsed.query || ctx.input.message.trim();
    const rememberedRestaurants = await ctx.step("load-memory", async () => {
      const named = restaurantsMentionedInText(restaurants, query).map((item) => ({
        placeId: item.placeId,
        name: item.name,
      }));
      if (named.length > 0) {
        return rememberAgentChatRestaurants(ctx.input.eventId, named);
      }
      return getAgentChatMemory(ctx.input.eventId);
    });

    const focusedRestaurants = (() => {
      if (rememberedRestaurants.length === 0) {
        return restaurants.map((item) => omitUndefined(item));
      }
      const focused = restaurants.filter((item) =>
        rememberedRestaurants.some((remembered) => remembered.placeId === item.placeId),
      );
      return (focused.length > 0 ? focused : restaurants).map((item) => omitUndefined(item));
    })();

    let reply: string;
    try {
      const draft = await ctx.agent.run<AgentChatReply>(councilChatAgent, {
        input: {
          eventId: ctx.input.eventId,
          mention: parsed.mention,
          query,
          message: ctx.input.message.trim(),
          event: omitUndefined({
            name: user.event.name,
            date: user.event.date,
            timezone: user.event.timezone,
            locationLabel: user.event.locationLabel,
          }),
          restaurants: focusedRestaurants,
          rememberedRestaurants,
          recentChat,
        },
      });
      reply = replyFromAgentOutput(draft);
    } catch (error) {
      console.error("council-chat agent failed", error);
      reply = replyFromAgentOutput(lastChatToolResult.get(ctx.input.eventId) ?? null);
    } finally {
      lastChatToolResult.delete(ctx.input.eventId);
    }

    await ctx.step("remember-reply", async () => {
      const named = restaurantsMentionedInText(restaurants, reply).map((item) => ({
        placeId: item.placeId,
        name: item.name,
      }));
      if (named.length > 0) {
        await rememberAgentChatRestaurants(ctx.input.eventId, named);
      }
    });

    await ctx.tool(eventChat).run({
      eventId: ctx.input.eventId,
      body: reply,
      as: "council",
      createdAt: ctx.now().toISOString(),
    });

    return { reply };
  },
);

function rememberRestaurantFromTool(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    execute: async (raw, context) => {
      const result = await tool.execute(raw, context);
      const eventId =
        raw && typeof raw === "object" && "eventId" in raw
          ? String((raw as { eventId?: unknown }).eventId ?? "")
          : "";
      const record = result as { placeId?: unknown; restaurantName?: unknown };
      if (eventId && typeof record?.placeId === "string" && typeof record?.restaurantName === "string") {
        await rememberAgentChatRestaurants(eventId, [{ placeId: record.placeId, name: record.restaurantName }]);
      }
      if (eventId) {
        lastChatToolResult.set(eventId, result);
      }
      return result;
    },
  };
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
