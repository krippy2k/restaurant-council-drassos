import { getCouncilProgress, setCouncilProgress } from "./councilProgress.js";
import type { StartCouncilInput, StartCouncilOutput } from "./workflows/startCouncil.js";

export async function attachReconvenedCouncil<T extends Record<string, unknown>>(
  eventId: string,
  userId: string,
  payload: T,
  startCouncil: (input: StartCouncilInput) => Promise<StartCouncilOutput>,
): Promise<T & Partial<Pick<StartCouncilOutput, "restaurants" | "searchedAt">>> {
  const current = await getCouncilProgress(eventId);
  if (current?.status === "RUNNING") {
    return payload;
  }
  try {
    const council = await startCouncil({ eventId, userId });
    return {
      ...payload,
      restaurants: council.restaurants,
      searchedAt: council.searchedAt,
    };
  } catch (error) {
    await setCouncilProgress({
      eventId,
      status: "FAILED",
      agent: "Council Clerk",
      tool: "Stopped",
      error: error instanceof Error ? error.message : "Could not reconvene Council.",
    }).catch(() => undefined);
    throw error;
  }
}
