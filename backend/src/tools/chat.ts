import { defineTool } from "@drassos/core";
import { z } from "zod";
import {
  addCouncilChatMessage,
  addEventChatMessage,
  COUNCIL_CHAT_USER_ID,
} from "../chat.js";
import { getUserById } from "../users.js";

export const eventChatInputSchema = z
  .object({
    eventId: z.string().min(1),
    body: z.string().min(1).max(2000),
    as: z.enum(["user", "council"]),
    userId: z.string().min(1).optional(),
    createdAt: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.as === "user" && !value.userId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A userId is required when posting as a user.",
        path: ["userId"],
      });
    }
  });

export const eventChatOutputSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  userName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

export type EventChatToolInput = z.infer<typeof eventChatInputSchema>;
export type EventChatToolOutput = z.infer<typeof eventChatOutputSchema>;

export const eventChat = defineTool({
  name: "event-chat",
  description:
    "Add a message to an event chat room, either as a given user or as The Council.",
  input: eventChatInputSchema,
  output: eventChatOutputSchema,
  execute: async (raw) => {
    const input = eventChatInputSchema.parse(raw);
    const createdAt = input.createdAt ?? new Date().toISOString();
    if (input.as === "council") {
      const message = await addCouncilChatMessage({
        eventId: input.eventId,
        body: input.body,
        createdAt,
      });
      return {
        id: message.id,
        eventId: message.eventId,
        userId: message.userId,
        userName: "The Council",
        body: message.body,
        createdAt: message.createdAt,
      };
    }
    const user = await getUserById(String(input.userId));
    if (!user) {
      throw Object.assign(new Error("User was not found."), { status: 404 });
    }
    const message = await addEventChatMessage({
      id: crypto.randomUUID(),
      eventId: input.eventId,
      userId: user.id,
      body: input.body,
      createdAt,
    });
    return {
      id: message.id,
      eventId: message.eventId,
      userId: message.userId,
      userName: user.name,
      body: message.body,
      createdAt: message.createdAt,
    };
  },
});

export { COUNCIL_CHAT_USER_ID };
