import { defineTool } from "@drassos/core";
import { z } from "zod";
import { getEventById } from "../events.js";
import { findRestaurantByNameOrId } from "../domain/findRestaurant.js";
import { hoursLineForDate, hoursLineForWeekday } from "../domain/restaurantHours.js";
import { loadHoursAndPhotos } from "../places.js";
import { getRestaurantsForEvent, saveRestaurantSearch } from "../restaurants.js";

export const lookupRestaurantHoursInputSchema = z.object({
  eventId: z.string().min(1),
  placeId: z.string().min(1),
  weekday: z.string().min(1).max(120).optional(),
  date: z.string().min(1).max(40).optional(),
});

export const lookupRestaurantHoursOutputSchema = z.object({
  found: z.boolean(),
  restaurantName: z.string(),
  placeId: z.string(),
  hours: z.array(z.string()),
  hoursForDay: z.string().optional(),
  openNow: z.boolean().nullable().optional(),
  source: z.enum(["event", "places", "unknown"]),
  reason: z.string().optional(),
});

export type LookupRestaurantHoursInput = z.infer<typeof lookupRestaurantHoursInputSchema>;
export type LookupRestaurantHoursOutput = z.infer<typeof lookupRestaurantHoursOutputSchema>;

export const lookupRestaurantHours = defineTool({
  name: "lookup-restaurant-hours",
  description:
    "Look up published weekly hours for a restaurant on an event council search. Uses stored hours when present; otherwise loads Place Details. Missing hours are unknown, not closed.",
  input: lookupRestaurantHoursInputSchema,
  output: lookupRestaurantHoursOutputSchema,
  execute: async (raw) => {
    const input = lookupRestaurantHoursInputSchema.parse(raw);
    const search = await getRestaurantsForEvent(input.eventId);
    const restaurant = findRestaurantByNameOrId(search?.restaurants ?? [], input.placeId);
    if (!restaurant) {
      throw Object.assign(new Error("That restaurant is not in this event."), { status: 404 });
    }

    let hours = restaurant.hours?.filter((line) => line.trim()) ?? [];
    let openNow = restaurant.openNow ?? null;
    let source: "event" | "places" | "unknown" = hours.length > 0 ? "event" : "unknown";

    if (hours.length === 0) {
      const [fetched] = await loadHoursAndPhotos([restaurant]);
      hours = fetched?.hours?.filter((line) => line.trim()) ?? [];
      openNow = fetched?.openNow ?? openNow;
      if (hours.length > 0) {
        source = "places";
        if (search) {
          await saveRestaurantSearch({
            ...search,
            restaurants: search.restaurants.map((item) =>
              item.placeId === restaurant.placeId
                ? { ...item, hours, openNow: fetched?.openNow ?? item.openNow }
                : item,
            ),
          });
        }
      }
    }

    const event = await getEventById(input.eventId);
    const hoursForDay =
      hoursLineForWeekday(hours, input.weekday) ??
      hoursLineForDate(hours, input.date ?? event?.date, event?.timezone);

    if (hours.length === 0) {
      return {
        found: false,
        restaurantName: restaurant.name,
        placeId: restaurant.placeId,
        hours: [],
        openNow,
        source: "unknown" as const,
        reason: "unknown_hours",
      };
    }

    return {
      found: true,
      restaurantName: restaurant.name,
      placeId: restaurant.placeId,
      hours,
      hoursForDay,
      openNow,
      source,
    };
  },
});
