import { workflow, type HumanDecision } from "@drassos/core";
import { findContactByName, getContactById } from "../contacts.js";
import type { Event, Invitation } from "../domain/types.js";
import { getEventById } from "../events.js";
import { createInvitation, getInvitationById, respondToInvitation } from "../invitations.js";
import { addJoinedMember } from "../members.js";
import { getUserById } from "../users.js";

export type InviteToEventInput = {
  eventId: string;
  ownerId: string;
  email?: string;
  contactId?: string;
  contactName?: string;
};

export type InviteToEventOutput = {
  invitation: Invitation;
};

export const inviteToEventWorkflow = workflow<InviteToEventInput, InviteToEventOutput>(
  "invite-to-event",
  async (ctx) => {
    const event = await ctx.step("load-event", async () => {
      const found = await getEventById(ctx.input.eventId);
      if (!found) {
        throw Object.assign(new Error("Event was not found."), { status: 404 });
      }
      if (found.ownerId !== ctx.input.ownerId) {
        throw Object.assign(new Error("Only the host can invite people."), { status: 403 });
      }
      return found;
    });

    const email = await ctx.step("resolve-invitee", async () => {
      if (ctx.input.contactId) {
        const contact = await getContactById(ctx.input.contactId, ctx.input.ownerId);
        if (!contact) {
          throw Object.assign(new Error("Contact was not found."), { status: 404 });
        }
        return contact.email;
      }
      if (ctx.input.contactName?.trim()) {
        const contact = await findContactByName(ctx.input.ownerId, ctx.input.contactName);
        return contact.email;
      }
      const value = String(ctx.input.email ?? "").trim();
      if (!value) {
        throw Object.assign(new Error("Invite someone by email or contact name."), { status: 400 });
      }
      return value;
    });

    const invitation = await ctx.step("create-invitation", async () =>
      createInvitation({
        id: ctx.uuid(),
        eventId: event.id,
        invitedBy: ctx.input.ownerId,
        email,
        createdAt: ctx.now().toISOString(),
        workflowRunId: ctx.runId,
      }),
    );

    const decision = await ctx.approval({
      id: "respond-invitation",
      title: `Join ${event.name}?`,
      description: inviteApprovalDescription(event, email),
      metadata: { invitation, event },
    });

    if (decision.outcome !== "approved" && decision.outcome !== "rejected") {
      throw new Error(
        decision.outcome === "timed_out" ? "The invitation timed out." : "The invitation was cancelled.",
      );
    }

    const responderId = responderIdFromDecision(decision, invitation);
    const user = await ctx.step("load-responder", async () => {
      const current = await getInvitationById(invitation.id);
      const id = responderId ?? current?.userId ?? undefined;
      const found = id ? await getUserById(id) : null;
      if (!found) {
        throw Object.assign(new Error("That invitation is not for a registered user yet."), { status: 409 });
      }
      return found;
    });

    if (decision.outcome === "approved") {
      const accepted = await ctx.step("accept-invitation", async () =>
        respondToInvitation({
          invitationId: invitation.id,
          userId: user.id,
          email: user.email,
          outcome: "accepted",
          respondedAt: ctx.now().toISOString(),
        }),
      );
      await ctx.step("join-event", async () =>
        addJoinedMember({
          eventId: accepted.eventId,
          userId: user.id,
          joinedAt: ctx.now().toISOString(),
        }),
      );
      return { invitation: accepted };
    }

    if (decision.outcome === "rejected") {
      const rejected = await ctx.step("reject-invitation", async () =>
        respondToInvitation({
          invitationId: invitation.id,
          userId: user.id,
          email: user.email,
          outcome: "rejected",
          reason: decision.reason,
          respondedAt: ctx.now().toISOString(),
        }),
      );
      return { invitation: rejected };
    }

    throw new Error("The invitation was cancelled.");
  },
);

function inviteApprovalDescription(event: Event, email: string): string {
  const when = formatInviteWhen(event.date);
  return `${email} was invited to ${event.name}${when ? ` on ${when}` : ""}. Accept to join, or reject with a reason.`;
}

function formatInviteWhen(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return value;
  }
  const date = instant.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  if (!/T\d{2}:\d{2}/.test(value)) {
    return date;
  }
  const time = instant
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(" ", "")
    .toLowerCase();
  return `${date} at ${time}`;
}

function responderIdFromDecision(decision: HumanDecision, invitation: Invitation): string | undefined {
  if (decision.outcome === "approved" && decision.data && typeof decision.data === "object") {
    const userId = (decision.data as { userId?: unknown }).userId;
    if (typeof userId === "string" && userId) {
      return userId;
    }
  }
  return invitation.userId ?? undefined;
}
