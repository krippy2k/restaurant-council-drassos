import { workflow } from "@drassos/core";
import {
  buildCreateEventCommand,
  type EventCommandDraft,
} from "../domain/commands.js";
import type { CreateEventCommand } from "../domain/types.js";
import { interpretEventAgent } from "./createEvent.js";

export type UpdateEventInput = {
  message: string;
  timezone: string;
  previousCommand: CreateEventCommand;
};

export const updateEventWorkflow = workflow<UpdateEventInput, CreateEventCommand>(
  "update-event",
  async (ctx) => {
    const message = String(ctx.input.message ?? "").trim();
    if (!message) {
      throw new Error("Describe the change you want.");
    }

    const draft = await ctx.agent.run<EventCommandDraft>(interpretEventAgent, {
      input: {
        message,
        currentDateTime: ctx.now().toISOString(),
        timezone: ctx.input.timezone,
        previousCommand: ctx.input.previousCommand,
        changeRequest: message,
      },
    });

    return ctx.step("build-command", async () =>
      buildCreateEventCommand(draft, ctx.input.timezone, ctx.input.previousCommand),
    );
  },
);
