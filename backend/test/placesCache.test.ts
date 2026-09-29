import { afterEach, describe, expect, it } from "vitest";
import {
  clearPlaceDetailsCache,
  loadHoursAndPhotos,
  PLACE_DETAILS_CACHE_TTL_MS,
  searchNearbyRestaurants,
  setNearbyRestaurantSearch,
  setPlaceDetailsCacheTtlMs,
  setPlaceHoursLoader,
} from "../src/places.ts";

describe("Google Places caching", () => {
  afterEach(async () => {
    setNearbyRestaurantSearch(undefined);
    setPlaceHoursLoader(undefined);
    setPlaceDetailsCacheTtlMs(undefined);
    await clearPlaceDetailsCache();
  });

  it("keeps restaurant details for seven days by default", () => {
    expect(PLACE_DETAILS_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("reuses restaurant details instead of calling Place Details again", async () => {
    let detailCalls = 0;
    setPlaceHoursLoader(async (placeId) => {
      detailCalls += 1;
      return { hours: [`Monday hours for ${placeId}`], phone: "555-0100", openNow: true };
    });
    const first = await loadHoursAndPhotos([{ placeId: "cheap", name: "Noodle Shop" }]);
    const second = await loadHoursAndPhotos([{ placeId: "cheap", name: "Noodle Shop" }]);
    expect(detailCalls).toBe(1);
    expect(first[0]?.hours).toEqual(["Monday hours for cheap"]);
    expect(second[0]?.hours).toEqual(["Monday hours for cheap"]);
    expect(second[0]?.phone).toBe("555-0100");
  });

  it("coalesces concurrent detail loads for the same restaurant", async () => {
    let detailCalls = 0;
    setPlaceHoursLoader(async () => {
      detailCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { hours: ["Tuesday: 11 AM – 9 PM"] };
    });
    await Promise.all([
      loadHoursAndPhotos([{ placeId: "cheap", name: "Noodle Shop" }]),
      loadHoursAndPhotos([{ placeId: "cheap", name: "Noodle Shop" }]),
    ]);
    expect(detailCalls).toBe(1);
  });

  it("refetches restaurant details after the cache expires", async () => {
    let detailCalls = 0;
    setPlaceHoursLoader(async () => {
      detailCalls += 1;
      return { hours: [`fetch-${detailCalls}`] };
    });
    setPlaceDetailsCacheTtlMs(1);
    await loadHoursAndPhotos([{ placeId: "cheap", name: "Noodle Shop" }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await loadHoursAndPhotos([{ placeId: "cheap", name: "Noodle Shop" }]);
    expect(detailCalls).toBe(2);
    expect(second[0]?.hours).toEqual(["fetch-2"]);
  });

  it("does not cache nearby search by location", async () => {
    let searchCalls = 0;
    setNearbyRestaurantSearch(async () => {
      searchCalls += 1;
      return [{ placeId: "cheap", name: "Noodle Shop" }];
    });
    const area = {
      displayName: "Cambridge",
      latitude: 42.37,
      longitude: -71.11,
      radiusMeters: 8000,
    };
    await searchNearbyRestaurants(area);
    await searchNearbyRestaurants(area);
    expect(searchCalls).toBe(2);
  });
});
