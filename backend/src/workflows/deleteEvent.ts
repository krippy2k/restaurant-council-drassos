import { workflow } from "@drassos/core";
import type { Event } from "../domain/types.js";
import { deleteEvent, getEventById } from "../events.js";

export type DeleteEventInput = {
  eventId: string;
  ownerId: string;
};

export type DeleteEventOutput = {
  deleted: true;
  eventId: string;
};

export const deleteEventWorkflow = workflow<DeleteEventInput, DeleteEventOutput>(
  "delete-event",
  async (ctx) => {
    const event = await ctx.step("load-event", async (): Promise<Event> => {
      const found = await getEventById(ctx.input.eventId);
      if (!found) {
        throw Object.assign(new Error("Event was not found."), { status: 404 });
      }
      if (found.ownerId !== ctx.input.ownerId) {
        throw Object.assign(new Error("That event belongs to another host."), { status: 403 });
      }
      return found;
    });

    const decision = await ctx.approval({
      id: "confirm-delete",
      title: `Delete ${event.name}?`,
      description: `This will permanently delete ${event.name}. This cannot be undone.`,
      metadata: { event },
    });

    if (decision.outcome === "approved") {
      await ctx.step("delete-event", async () => {
        await deleteEvent(event.id);
      });
      return { deleted: true, eventId: event.id };
    }

    const reason =
      decision.outcome === "rejected"
        ? decision.reason ?? "Event deletion was cancelled."
        : "Event deletion timed out.";
    throw new Error(reason);
  },
);
