import { describe, expect, it } from "vitest";
import { hoursLineForDate, hoursLineForWeekday } from "../src/domain/restaurantHours.ts";
import { findRestaurantByNameOrId, normalizeRestaurantName, restaurantsMentionedInText } from "../src/domain/findRestaurant.ts";

describe("restaurant hours matching", () => {
  const weekly = [
    "Monday: 11:00 AM – 9:00 PM",
    "Tuesday: Closed",
    "Friday: 5:00 PM – 10:00 PM",
  ];

  it("finds the weekday line from published hours", () => {
    expect(hoursLineForWeekday(weekly, "Friday")).toBe("Friday: 5:00 PM – 10:00 PM");
    expect(hoursLineForWeekday(weekly, "tuesday")).toBe("Tuesday: Closed");
    expect(hoursLineForWeekday(weekly, "Sunday")).toBeUndefined();
  });

  it("finds hours for an event date", () => {
    expect(hoursLineForDate(weekly, "2026-09-25")).toBe("Friday: 5:00 PM – 10:00 PM");
  });

  it("treats next Saturday as Saturday", () => {
    const weekend = ["Friday: 5:00 PM – 10:00 PM", "Saturday: 11:30 AM – 1:00 AM"];
    expect(hoursLineForWeekday(weekend, "next Saturday")).toBe("Saturday: 11:30 AM – 1:00 AM");
    expect(hoursLineForWeekday(weekend, "this Saturday")).toBe("Saturday: 11:30 AM – 1:00 AM");
  });
});

describe("restaurant name matching for hours tool", () => {
  const coopers = {
    placeId: "ChIJjS1x3ASm2YgRmI_a_Wp8Mqc",
    name: "Cooper’s Hawk Winery & Restaurant",
  };

  it("treats curly and straight apostrophes as the same name", () => {
    expect(normalizeRestaurantName("Cooper's Hawk")).toBe(normalizeRestaurantName("Cooper’s Hawk"));
  });

  it("resolves a shortened Cooper's Hawk name to the listing", () => {
    expect(findRestaurantByNameOrId([coopers], "Cooper's Hawk")).toEqual(coopers);
  });

  it("finds Cooper's Hawk inside a later chat sentence", () => {
    expect(
      restaurantsMentionedInText([coopers], "what are the hours for Cooper's Hawk this Saturday?"),
    ).toEqual([coopers]);
    expect(restaurantsMentionedInText([coopers], "do they have bruschetta?")).toEqual([]);
  });

  it("finds Baoshi from a short lowercase name in an hours question", () => {
    const baoshi = { placeId: "baoshi-place", name: "Baoshi Food Hall + Bar" };
    expect(findRestaurantByNameOrId([baoshi, coopers], "baoshi")).toEqual(baoshi);
    expect(
      restaurantsMentionedInText([baoshi, coopers], "What are the hours for baoshi next Saturday?"),
    ).toEqual([baoshi]);
  });
});
