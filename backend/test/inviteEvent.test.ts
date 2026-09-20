import { afterEach, describe, expect, it } from "vitest";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { saveEvent } from "../src/events.ts";
import { getInvitationById, listPendingInvitationsForUser } from "../src/invitations.ts";
import { isEventMember } from "../src/members.ts";
import { getUserById } from "../src/users.ts";
import { addContactWorkflow } from "../src/workflows/addContact.ts";
import { inviteToEventWorkflow } from "../src/workflows/inviteToEvent.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

async function waitForPending(runtime: TestRuntime, runId: string) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const pending = await runtime.getPendingInteractions(runId);
    if (pending.length > 0) {
      return pending[0]!;
    }
    const run = await runtime.getRun(runId);
    if (run && (run.status === "FAILED" || run.status === "COMPLETED" || run.status === "CANCELLED")) {
      throw new Error(`Run ${run.status}: ${run.error?.message ?? JSON.stringify(run.output)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the invitation.");
}

describe("invite-to-event workflows", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("stays waiting until an existing user accepts", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const host = await runtime.execute(registerUserWorkflow, {
      name: "Host User",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const guest = await runtime.execute(registerUserWorkflow, {
      name: "Guest User",
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

    const { runId } = await runtime.start(inviteToEventWorkflow, {
      eventId: event.id,
      ownerId: host.output!.user.id,
      email: guest.output!.user.email,
    });
    const pending = await waitForPending(runtime, runId);
    expect(pending.title).toContain("Friday dinner");
    const invitationId = (pending.metadata as { invitation?: { id: string } } | null)?.invitation?.id;
    expect(invitationId).toEqual(expect.any(String));

    const waiting = await runtime.getRun(runId);
    expect(waiting?.status).toBe("WAITING");
    expect((await getInvitationById(invitationId!))?.status).toBe("pending");
    expect((await getUserById(guest.output!.user.id))?.pendingInvitationIds).toContain(invitationId);

    await runtime.approve(runId, pending.interactionId, { userId: guest.output!.user.id });
    const result = await runtime.wait(runId);
    expect(result.status).toBe("COMPLETED");
    expect(result.output).toMatchObject({
      invitation: { id: invitationId, status: "accepted", userId: guest.output!.user.id },
    });
    expect(await isEventMember(event.id, guest.output!.user.id)).toBe(true);
    expect((await getUserById(guest.output!.user.id))?.pendingInvitationIds).not.toContain(invitationId);
  }, 20_000);

  it("flags an unknown email and completes when that person registers and declines", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const host = await runtime.execute(registerUserWorkflow, {
      name: "Host User",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: host.output!.user.id,
      name: "Saturday lunch",
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const futureEmail = `new-${crypto.randomUUID()}@council.test`;

    const { runId } = await runtime.start(inviteToEventWorkflow, {
      eventId: event.id,
      ownerId: host.output!.user.id,
      email: futureEmail,
    });
    const pending = await waitForPending(runtime, runId);
    const invitationId = (pending.metadata as { invitation?: { id: string } } | null)?.invitation?.id;
    expect((await getInvitationById(invitationId!))?.userId).toBeNull();

    const registered = await runtime.execute(registerUserWorkflow, {
      name: "New Guest",
      email: futureEmail,
      password: "correct-horse",
    });
    expect(registered.status).toBe("COMPLETED");
    expect(registered.output?.user.pendingInvitationIds).toContain(invitationId);
    expect(await listPendingInvitationsForUser(registered.output!.user.id, futureEmail)).toHaveLength(1);
    expect((await runtime.getRun(runId))?.status).toBe("WAITING");

    await runtime.completeInteraction(runId, pending.interactionId, {
      outcome: "rejected",
      reason: "I am out of town.",
    });
    const result = await runtime.wait(runId);
    expect(result.status).toBe("COMPLETED");
    expect(result.output).toMatchObject({
      invitation: {
        id: invitationId,
        status: "rejected",
        rejectReason: "I am out of town.",
      },
    });
    expect(await isEventMember(event.id, registered.output!.user.id)).toBe(false);
  }, 20_000);

  it("invites a saved contact by name and waits for a response", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const host = await runtime.execute(registerUserWorkflow, {
      name: "Host User",
      email: `host-${crypto.randomUUID()}@council.test`,
      password: "correct-horse",
    });
    const event = await saveEvent({
      id: crypto.randomUUID(),
      ownerId: host.output!.user.id,
      name: "Sunday brunch",
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const contactEmail = `pat-${crypto.randomUUID()}@council.test`;
    const contact = await runtime.execute(addContactWorkflow, {
      ownerId: host.output!.user.id,
      name: "Pat Rivera",
      email: contactEmail,
    });
    expect(contact.status).toBe("COMPLETED");

    const { runId } = await runtime.start(inviteToEventWorkflow, {
      eventId: event.id,
      ownerId: host.output!.user.id,
      contactName: "Pat Rivera",
    });
    const pending = await waitForPending(runtime, runId);
    expect(pending.metadata).toMatchObject({
      invitation: { email: contactEmail, status: "pending" },
    });
    expect((await runtime.getRun(runId))?.status).toBe("WAITING");
  }, 20_000);
});
