import { defineAgent, workflow } from "@drassos/core";
import {
  buildCreateEventCommand,
  eventCommandDraftSchema,
  eventFromCommand,
  summarizeCommand,
  type EventCommandDraft,
} from "../domain/commands.js";
import type { CreateEventCommand, Event } from "../domain/types.js";
import { saveEvent } from "../events.js";

export type CreateEventInput = {
  message: string;
  ownerId: string;
  timezone: string;
};

export type CreateEventOutput = Event;

export const interpretEventAgent = defineAgent({
  name: "interpret-event",
  model: "openai:gpt-4o-mini",
  instructions: [
    "You are the intake clerk for Restaurant Council.",
    "Translate a host's chat message into an event creation command draft.",
    "Return JSON with:",
    '- "name": short event title (max 80 characters)',
    '- "date": optional ISO date (YYYY-MM-DD) or datetime; resolve relative dates using currentDateTime and timezone',
    '- "timezone": IANA timezone when known',
    '- "locationLabel": the place, neighborhood, or city to search near, taken from the user text',
    '- "radiusMiles": search radius in miles, default 5 if unspecified',
    '- "constraints": required venue constraints mentioned in the message',
    'Kid friendly or family friendly becomes { "type": "kid-friendly", "strength": "required" }.',
    "Never invent coordinates, place IDs, or a location that is not grounded in the message or previous command.",
    "If changeRequest is present, apply those edits to previousCommand and return the updated draft.",
    "Do not include searchArea; application code resolves the location.",
  ].join(" "),
  output: eventCommandDraftSchema,
  limits: {
    maxTurns: 4,
    timeout: "60s",
  },
});

export const createEventWorkflow = workflow<CreateEventInput, Event>("create-event", async (ctx) => {
  const message = String(ctx.input.message ?? "").trim();
  if (!message) {
    throw new Error("Write a message before submitting.");
  }

  let sourceText = message;
  let previousCommand: CreateEventCommand | undefined;
  let changeRequest: string | undefined;

  for (let turn = 0; turn < 8; turn += 1) {
    const draft = await ctx.agent.run<EventCommandDraft>(interpretEventAgent, {
      input: {
        message: sourceText,
        currentDateTime: ctx.now().toISOString(),
        timezone: ctx.input.timezone,
        ...(previousCommand ? { previousCommand } : {}),
        ...(changeRequest ? { changeRequest } : {}),
      },
    });

    const command = await ctx.step(`build-command-${turn}`, async () =>
      buildCreateEventCommand(draft, ctx.input.timezone, previousCommand),
    );

    const decision = await ctx.approval({
      id: `confirm-event-${turn}`,
      title: `Create ${command.name}?`,
      description: summarizeCommand(command),
      metadata: { command },
    });

    if (decision.outcome === "approved") {
      const id = ctx.uuid();
      const nowIso = ctx.now().toISOString();
      return ctx.step("save-event", async () =>
        saveEvent(eventFromCommand(command, ctx.input.ownerId, nowIso, id)),
      );
    }

    if (decision.outcome === "changes_requested") {
      previousCommand = command;
      changeRequest = decision.feedback;
      sourceText = decision.feedback;
      continue;
    }

    const reason =
      decision.outcome === "rejected"
        ? decision.reason ?? "Event creation was cancelled."
        : "Event creation timed out.";
    throw new Error(reason);
  }

  throw new Error("Too many revision rounds for this event.");
});
