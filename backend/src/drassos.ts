import { existsSync, readFileSync, unlinkSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi, listenApi } from "@drassos/api";
import { Drassos } from "@drassos/node";
import type { HumanDecision, HumanInteraction, WorkflowRun, WorkflowStatus } from "@drassos/core";
import { createCouncilApp } from "./app.js";
import type { CreateEventCommand, Event, Invitation } from "./domain/types.js";
import { getInvitationById } from "./invitations.js";
import { getUserById } from "./users.js";
import { addContactWorkflow, type AddContactInput } from "./workflows/addContact.js";
import {
  addEventPreferencesWorkflow,
  type AddEventPreferencesInput,
} from "./workflows/addEventPreferences.js";
import { createEventWorkflow, type CreateEventInput } from "./workflows/createEvent.js";
import { deleteEventWorkflow, type DeleteEventInput } from "./workflows/deleteEvent.js";
import { inviteToEventWorkflow, type InviteToEventInput } from "./workflows/inviteToEvent.js";
import { loginUserWorkflow, type LoginUserInput } from "./workflows/loginUser.js";
import { logoutUserWorkflow, type LogoutUserInput } from "./workflows/logoutUser.js";
import { registerUserWorkflow, type RegisterUserInput } from "./workflows/registerUser.js";
import { startCouncilWorkflow, type StartCouncilInput } from "./workflows/startCouncil.js";
import { decideRestaurantWorkflow, type DecideRestaurantInput } from "./workflows/decideRestaurant.js";
import { agentChatRequestWorkflow, type AgentChatRequestInput } from "./workflows/agentChat.js";
import { setCouncilProgress } from "./councilProgress.js";
import { updateEventWorkflow } from "./workflows/updateEvent.js";
import type { PublicUser } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", ".drassos");
const TERMINAL: WorkflowStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

export type WorkflowSnapshot = {
  runId: string;
  status: WorkflowStatus;
  command?: CreateEventCommand;
  interactionId?: string;
  event?: Event;
  invitation?: Invitation;
  deleted?: boolean;
  error?: string;
};

let runtime: Drassos | undefined;
let starting: Promise<Drassos> | undefined;
let consoleServer: { port: number; close: () => Promise<void> } | undefined;

export async function getDrassos(): Promise<Drassos> {
  if (runtime) {
    return runtime;
  }
  if (!starting) {
    starting = startRuntime().catch((error) => {
      starting = undefined;
      runtime = undefined;
      throw error;
    });
  }
  return starting;
}

export function clearStalePgliteLock(root: string, pidAlive: (pid: number) => boolean = processExists): void {
  const pidFile = path.join(root, "pglite", "postmaster.pid");
  if (!existsSync(pidFile)) {
    return;
  }
  const pid = Number(readFileSync(pidFile, "utf8").split(/\r?\n/)[0]?.trim());
  if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) {
    return;
  }
  unlinkSync(pidFile);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startRuntime(): Promise<Drassos> {
  const app = createCouncilApp();
  if (!app.models?.openai && !process.env.OPENAI_API_KEY) {
    throw new Error("Set OPENAI_API_KEY so the Create Event agent can interpret chat messages.");
  }
  clearStalePgliteLock(dataDir);
  const instance = new Drassos({
    inMemory: process.env.DRASSOS_IN_MEMORY === "true",
    databaseUrl: process.env.DATABASE_URL,
    dataDir,
    pollMs: 50,
    allowReplace: true,
    logLevel: process.env.DRASSOS_LOG_LEVEL ?? "info",
    app,
  });
  await instance.start();
  await startConsole(instance);
  runtime = instance;
  return instance;
}

export async function startCreateEventWorkflow(input: CreateEventInput): Promise<WorkflowSnapshot> {
  const drassos = await getDrassos();
  drassos.register(createEventWorkflow);
  await drassos.start();
  const run = await drassos.runtime().executor.startRun(createEventWorkflow.name, input);
  return waitForCheckpoint(drassos, run.id);
}

export async function decideCreateEventWorkflow(
  runId: string,
  ownerId: string,
  decision: HumanDecision,
): Promise<WorkflowSnapshot> {
  const drassos = await getDrassos();
  await assertOwner(drassos, runId, ownerId);
  const pending = await drassos.getPendingInteractions(runId);
  const interaction = pending[0];
  if (!interaction) {
    throw Object.assign(new Error("This event is not waiting for a decision."), { status: 409 });
  }
  await drassos.completeInteraction(runId, interaction.interactionId, decision);
  return waitForCheckpoint(drassos, runId);
}

export async function startDeleteEventWorkflow(input: DeleteEventInput): Promise<WorkflowSnapshot> {
  const drassos = await getDrassos();
  drassos.register(deleteEventWorkflow);
  await drassos.start();
  const run = await drassos.runtime().executor.startRun(deleteEventWorkflow.name, input);
  return waitForCheckpoint(drassos, run.id);
}

export async function interpretEventUpdate(input: {
  message: string;
  timezone: string;
  previousCommand: CreateEventCommand;
}): Promise<CreateEventCommand> {
  const drassos = await getDrassos();
  drassos.register(updateEventWorkflow);
  await drassos.start();
  const result = await drassos.execute(updateEventWorkflow, input, { timeoutMs: 90_000 });
  if (result.status !== "COMPLETED" || result.output == null) {
    throw Object.assign(new Error(result.error?.message ?? "Could not interpret that change."), {
      status: 502,
    });
  }
  return result.output;
}

export async function runRegisterUserWorkflow(input: RegisterUserInput): Promise<PublicUser> {
  const drassos = await getDrassos();
  drassos.register(registerUserWorkflow);
  await drassos.start();
  const result = await drassos.execute(registerUserWorkflow, input, { timeoutMs: 30_000 });
  if (result.status !== "COMPLETED" || result.output == null) {
    throw workflowFailure(result.error?.message, "Could not create the account.", {
      "already exists": 409,
      "must be": 400,
      "valid email": 400,
    });
  }
  return result.output.user;
}

export async function runLoginUserWorkflow(input: LoginUserInput): Promise<PublicUser> {
  const drassos = await getDrassos();
  drassos.register(loginUserWorkflow);
  await drassos.start();
  const result = await drassos.execute(loginUserWorkflow, input, { timeoutMs: 30_000 });
  if (result.status !== "COMPLETED" || result.output == null) {
    throw workflowFailure(result.error?.message, "Could not sign in.", {
      "Invalid email or password": 401,
    });
  }
  return result.output.user;
}

export async function runLogoutUserWorkflow(input: LogoutUserInput): Promise<{ loggedOut: true; userId: string }> {
  const drassos = await getDrassos();
  drassos.register(logoutUserWorkflow);
  await drassos.start();
  const result = await drassos.execute(logoutUserWorkflow, input, { timeoutMs: 30_000 });
  if (result.status !== "COMPLETED" || result.output == null) {
    throw workflowFailure(result.error?.message, "Could not sign out.", {
      "Sign in to continue": 401,
    });
  }
  return result.output;
}

export async function startInviteToEventWorkflow(input: InviteToEventInput): Promise<Invitation> {
  const drassos = await getDrassos();
  drassos.register(inviteToEventWorkflow);
  await drassos.start();
  const run = await drassos.runtime().executor.startRun(inviteToEventWorkflow.name, input);
  const snapshot = await waitForCheckpoint(drassos, run.id);
  if (snapshot.status === "WAITING") {
    const invitation = invitationFromUnknown(snapshot.invitation) ?? (await invitationFromRun(drassos, run.id));
    if (invitation) {
      return invitation;
    }
  }
  throw workflowFailure(snapshot.error, "Could not send that invite.", {
    "Only the host": 403,
    "not found": 404,
    "already has a pending": 409,
    "cannot invite yourself": 400,
    "valid email": 400,
    "Invite someone": 400,
    "More than one contact": 409,
  });
}

export async function decideInviteToEventWorkflow(input: {
  invitationId: string;
  userId: string;
  outcome: "accepted" | "rejected";
  reason?: string;
}): Promise<Invitation> {
  const user = await getUserById(input.userId);
  if (!user) {
    throw Object.assign(new Error("User was not found."), { status: 404 });
  }
  const invitation = await getInvitationById(input.invitationId);
  if (!invitation) {
    throw Object.assign(new Error("Invitation was not found."), { status: 404 });
  }
  if (invitation.status !== "pending") {
    throw Object.assign(new Error("That invitation was already answered."), { status: 409 });
  }
  if (invitation.userId !== user.id && invitation.email !== user.email) {
    throw Object.assign(new Error("That invitation is not for you."), { status: 403 });
  }
  if (input.outcome === "rejected" && !String(input.reason ?? "").trim()) {
    throw Object.assign(new Error("Say why you are declining."), { status: 400 });
  }
  const runId = invitation.workflowRunId;
  if (!runId) {
    throw Object.assign(new Error("This invitation is not waiting for a decision."), { status: 409 });
  }

  const drassos = await getDrassos();
  const pending = await drassos.getPendingInteractions(runId);
  const interaction = pending[0];
  if (!interaction) {
    throw Object.assign(new Error("This invitation is not waiting for a decision."), { status: 409 });
  }
  await drassos.completeInteraction(
    runId,
    interaction.interactionId,
    input.outcome === "accepted"
      ? { outcome: "approved", data: { userId: user.id } }
      : { outcome: "rejected", reason: String(input.reason ?? "").trim() },
  );
  const snapshot = await waitForCheckpoint(drassos, runId);
  const answered =
    invitationFromUnknown(snapshot.invitation) ?? (await invitationFromRun(drassos, runId)) ?? (await getInvitationById(input.invitationId));
  if (snapshot.status !== "COMPLETED" || !answered) {
    throw workflowFailure(snapshot.error, "Could not answer that invitation.", {
      "not for a registered user": 409,
      "not for you": 403,
      "not found": 404,
      "already answered": 409,
      "declining": 400,
    });
  }
  return answered;
}

export async function runAddContactWorkflow(input: AddContactInput) {
  const drassos = await getDrassos();
  drassos.register(addContactWorkflow);
  await drassos.start();
  const result = await drassos.execute(addContactWorkflow, input, { timeoutMs: 30_000 });
  if (result.status !== "COMPLETED" || result.output == null) {
    throw workflowFailure(result.error?.message, "Could not save that contact.", {
      "already in your contacts": 409,
      "valid email": 400,
      "must be": 400,
    });
  }
  return result.output.contact;
}

export async function runAddEventPreferencesWorkflow(input: AddEventPreferencesInput) {
  const drassos = await getDrassos();
  drassos.register(addEventPreferencesWorkflow);
  await drassos.start();
  const result = await drassos.execute(addEventPreferencesWorkflow, input, { timeoutMs: 90_000 });
  if (result.status !== "COMPLETED" || result.output == null) {
    throw workflowFailure(result.error?.message, "Could not save those constraints.", {
      "Say a constraint": 400,
      "not found": 404,
      "another host": 403,
    });
  }
  return result.output.preferences;
}

export async function runStartCouncilWorkflow(input: StartCouncilInput) {
  const drassos = await getDrassos();
  drassos.register(startCouncilWorkflow);
  await drassos.start();
  try {
    const result = await drassos.execute(startCouncilWorkflow, input, { timeoutMs: 90_000 });
    if (result.status !== "COMPLETED" || result.output == null) {
      throw workflowFailure(result.error?.message, "Could not start Council.", {
        "GOOGLE_PLACES_API_KEY": 500,
        "search area": 400,
        "not found": 404,
        "another host": 403,
        "Google Places": 502,
      });
    }
    return result.output;
  } catch (error) {
    await setCouncilProgress({
      eventId: input.eventId,
      status: "FAILED",
      agent: "Council Clerk",
      tool: "Stopped",
      error: error instanceof Error ? error.message : "Could not start Council.",
    }).catch(() => undefined);
    throw error;
  }
}

export async function runAgentChatRequestWorkflow(input: AgentChatRequestInput) {
  const drassos = await getDrassos();
  drassos.register(agentChatRequestWorkflow);
  await drassos.start();
  const result = await drassos.execute(agentChatRequestWorkflow, input, { timeoutMs: 90_000 });
  if (result.status !== "COMPLETED" || result.output == null) {
    throw workflowFailure(result.error?.message, "Could not answer that chat request.", {
      "Start the message": 400,
      "not found": 404,
      "another host": 403,
    });
  }
  return result.output;
}

export async function runDecideRestaurantWorkflow(input: DecideRestaurantInput) {
  const drassos = await getDrassos();
  drassos.register(decideRestaurantWorkflow);
  await drassos.start();
  const result = await drassos.execute(decideRestaurantWorkflow, input, { timeoutMs: 30_000 });
  if (result.status !== "COMPLETED" || result.output == null) {
    throw workflowFailure(result.error?.message, "Could not save that restaurant decision.", {
      "Choose Approve": 400,
      "Choose a restaurant": 400,
      "not found": 404,
      "another host": 403,
      "Start Council": 404,
    });
  }
  return result.output.restaurant;
}

export async function getCreateEventSnapshot(runId: string, ownerId: string): Promise<WorkflowSnapshot> {
  const drassos = await getDrassos();
  await assertOwner(drassos, runId, ownerId);
  return snapshotFromRun(drassos, await requireRun(drassos, runId));
}

export async function stopDrassos(): Promise<void> {
  starting = undefined;
  if (consoleServer) {
    await consoleServer.close().catch(() => undefined);
    consoleServer = undefined;
  }
  if (runtime) {
    await runtime.stop();
    runtime = undefined;
  }
}

function workflowFailure(
  message: string | undefined,
  fallback: string,
  statuses: Record<string, number>,
): Error {
  const text = message?.trim() || fallback;
  const status =
    Object.entries(statuses).find(([needle]) => text.includes(needle))?.[1] ?? 502;
  return Object.assign(new Error(text), { status });
}

function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function startConsole(drassos: Drassos): Promise<void> {
  if (process.env.DRASSOS_CONSOLE === "false") {
    return;
  }
  const consoleDir = findConsoleDir();
  if (!consoleDir) {
    console.warn(
      "Drassos Console UI not found. Run `pnpm --filter @drassos/console build` in drassos-engine, or set DRASSOS_CONSOLE_DIR.",
    );
  }
  const port = Number(process.env.DRASSOS_PORT ?? 3100);
  if (await isPortInUse(port)) {
    console.warn(`Drassos Console port ${port} is already in use; skipping.`);
    return;
  }
  try {
    consoleServer = await listenApi(createApi({ drassos: drassos.runtime(), consoleDir }), { port });
    console.log(
      `Drassos Console on http://127.0.0.1:${consoleServer.port}${consoleDir ? "" : " (API only)"}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Drassos Console did not start on port ${port}: ${message}`);
  }
}

function findConsoleDir(): string | undefined {
  const fromEnv = process.env.DRASSOS_CONSOLE_DIR?.trim();
  const candidates = [
    fromEnv,
    path.resolve(here, "../../../drassos-engine/apps/console/dist"),
    path.resolve(process.cwd(), "../../drassos-engine/apps/console/dist"),
  ].filter((value): value is string => Boolean(value));
  const match = candidates.find((dir) => existsSync(path.join(dir, "index.html")));
  if (!match) {
    return undefined;
  }
  const relative = path.relative(process.cwd(), match);
  return (relative || ".").split(path.sep).join("/");
}

async function waitForCheckpoint(drassos: Drassos, runId: string, timeoutMs = 90_000): Promise<WorkflowSnapshot> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await requireRun(drassos, runId);
    if (TERMINAL.includes(run.status)) {
      return snapshotFromRun(drassos, run);
    }
    const pending = await drassos.getPendingInteractions(runId);
    if (run.status === "WAITING" && pending.length > 0) {
      return snapshotFromRun(drassos, run, pending[0]);
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw Object.assign(new Error("Timed out waiting for the workflow."), { status: 504 });
}

async function snapshotFromRun(
  drassos: Drassos,
  run: WorkflowRun,
  interaction?: HumanInteraction,
): Promise<WorkflowSnapshot> {
  const pending = interaction ?? (await drassos.getPendingInteractions(run.id))[0];
  const command = commandFromMetadata(pending?.metadata) ?? commandFromMetadata(run.output);
  const deleted = isDeletedOutput(run.output);
  const eventFromMeta = eventFromMetadata(pending?.metadata);
  const invitation =
    invitationFromUnknown(run.output) ?? invitationFromUnknown(pending?.metadata);
  return {
    runId: run.id,
    status: run.status,
    command,
    interactionId: pending?.interactionId,
    event: deleted ? undefined : run.status === "COMPLETED" && !invitation ? (run.output as unknown as Event) : eventFromMeta,
    invitation,
    deleted: run.status === "COMPLETED" && deleted,
    error: run.error?.message,
  };
}

function invitationFromUnknown(value: unknown): Invitation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as { invitation?: Invitation } & Partial<Invitation>;
  const invitation = record.invitation ?? (record.id && record.eventId && record.email ? (record as Invitation) : undefined);
  return invitation?.id && invitation.eventId ? invitation : undefined;
}

async function invitationFromRun(drassos: Drassos, runId: string): Promise<Invitation | undefined> {
  const run = await requireRun(drassos, runId);
  const pending = await drassos.getPendingInteractions(runId);
  return invitationFromUnknown(run.output) ?? invitationFromUnknown(pending[0]?.metadata);
}

function isDeletedOutput(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as { deleted?: unknown }).deleted === true;
}

function eventFromMetadata(value: unknown): Event | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const event = (value as { event?: Event }).event;
  return event?.id && event.name ? event : undefined;
}

function commandFromMetadata(value: unknown): CreateEventCommand | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as { command?: CreateEventCommand };
  return record.command;
}

async function assertOwner(drassos: Drassos, runId: string, ownerId: string): Promise<void> {
  const run = await requireRun(drassos, runId);
  const input = run.input as { ownerId?: string } | null;
  if (input?.ownerId !== ownerId) {
    throw Object.assign(new Error("That workflow belongs to another host."), { status: 403 });
  }
}

async function requireRun(drassos: Drassos, runId: string): Promise<WorkflowRun> {
  const run = await drassos.getRun(runId);
  if (!run) {
    throw Object.assign(new Error("Workflow run was not found."), { status: 404 });
  }
  return run;
}

