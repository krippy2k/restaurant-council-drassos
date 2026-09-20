import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CouncilRestaurant } from "./domain/matchRestaurants.js";
import { applyVerificationToCheck, verificationSummary, type ConstraintContactMethod, type ConstraintVerificationResult } from "./domain/verifyConstraint.js";

export type EventRestaurantSearch = {
  eventId: string;
  searchedAt: string;
  restaurants: CouncilRestaurant[];
};

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const restaurantsFile = path.join(dataDir, "restaurants.json");

let writeQueue: Promise<void> = Promise.resolve();

async function loadSearches(): Promise<EventRestaurantSearch[]> {
  try {
    const raw = await readFile(restaurantsFile, "utf8");
    const parsed = JSON.parse(raw) as EventRestaurantSearch[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveSearches(searches: EventRestaurantSearch[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(restaurantsFile, JSON.stringify(searches, null, 2), "utf8");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function getRestaurantsForEvent(eventId: string): Promise<EventRestaurantSearch | null> {
  const searches = await loadSearches();
  return searches.find((item) => item.eventId === eventId) ?? null;
}

export async function saveRestaurantSearch(next: EventRestaurantSearch): Promise<EventRestaurantSearch> {
  return enqueue(async () => {
    const searches = await loadSearches();
    const index = searches.findIndex((item) => item.eventId === next.eventId);
    if (index < 0) {
      searches.push(next);
    } else {
      searches[index] = next;
    }
    await saveSearches(searches);
    return next;
  });
}

export async function addConstraintVerification(input: {
  eventId: string;
  placeId: string;
  constraintId: string;
  result: ConstraintVerificationResult;
  method: ConstraintContactMethod;
  notes?: string;
  userId: string;
  userName: string;
}): Promise<CouncilRestaurant> {
  return enqueue(async () => {
    const searches = await loadSearches();
    const search = searches.find((item) => item.eventId === input.eventId);
    if (!search) {
      throw Object.assign(new Error("Start Council before verifying a restaurant."), { status: 404 });
    }
    const restaurantIndex = search.restaurants.findIndex((item) => item.placeId === input.placeId);
    const restaurant = search.restaurants[restaurantIndex];
    if (!restaurant) {
      throw Object.assign(new Error("That restaurant is not in this Council search."), { status: 404 });
    }
    const check = restaurant.constraintChecks?.find((item) => item.id === input.constraintId);
    if (!check) {
      throw Object.assign(new Error("That constraint is not on this restaurant."), { status: 404 });
    }
    const verification = {
      id: crypto.randomUUID(),
      result: input.result,
      method: input.method,
      notes: input.notes?.trim() || undefined,
      verifiedByUserId: input.userId,
      verifiedByName: input.userName,
      verifiedAt: new Date().toISOString(),
      summary: verificationSummary({
        result: input.result,
        method: input.method,
        verifiedByName: input.userName,
        notes: input.notes,
      }),
    };
    const nextRestaurant: CouncilRestaurant = {
      ...restaurant,
      constraintChecks: (restaurant.constraintChecks ?? []).map((item) =>
        item.id === check.id ? applyVerificationToCheck(item, verification) : item,
      ),
    };
    search.restaurants[restaurantIndex] = nextRestaurant;
    await saveSearches(searches);
    return nextRestaurant;
  });
}
