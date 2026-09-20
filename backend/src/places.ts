import type { EventSearchArea } from "./domain/types.js";
import type { PlaceRestaurant } from "./domain/matchRestaurants.js";

export type NearbySearch = (area: EventSearchArea) => Promise<PlaceRestaurant[]>;

export type PlaceHoursAndPhoto = {
  photoUrl?: string;
  hours?: string[];
  openNow?: boolean | null;
  website?: string;
  phone?: string;
  email?: string;
  reviews?: Array<{ text: string; authorName?: string; publishedAt?: string }>;
  servesVegetarianFood?: boolean | null;
  primaryType?: string;
};

export type PlaceHoursLoader = (placeId: string) => Promise<PlaceHoursAndPhoto>;

let searcher: NearbySearch = searchGooglePlaces;
let hoursLoader: PlaceHoursLoader = fetchGoogleHoursAndPhoto;

export function setNearbyRestaurantSearch(next: NearbySearch | undefined): void {
  searcher = next ?? searchGooglePlaces;
}

export function setPlaceHoursLoader(next: PlaceHoursLoader | undefined): void {
  hoursLoader = next ?? fetchGoogleHoursAndPhoto;
}

export async function searchNearbyRestaurants(area: EventSearchArea): Promise<PlaceRestaurant[]> {
  return searcher(area);
}

function placesApiKey(): string {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("Set GOOGLE_PLACES_API_KEY to search for restaurants."), { status: 500 });
  }
  return apiKey;
}

async function searchGooglePlaces(area: EventSearchArea): Promise<PlaceRestaurant[]> {
  const query = area.displayName?.trim();
  if (!query) {
    throw Object.assign(new Error("This event needs a location before Council can start."), { status: 400 });
  }
  const center = await geocodeLocation(query);
  const radius = Math.min(50_000, Math.max(50, Math.round(area.radiusMeters || 8000)));
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: placesHeaders([
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.priceLevel",
      "places.types",
      "places.primaryType",
      "places.rating",
      "places.userRatingCount",
      "places.servesVegetarianFood",
      "places.goodForChildren",
    ]),
    body: JSON.stringify({
      includedPrimaryTypes: ["restaurant"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: center.latitude, longitude: center.longitude },
          radius,
        },
      },
    }),
  });
  if (!response.ok) {
    throw await placesError(response, "Google Places could not search that area.");
  }
  const payload = (await response.json()) as { places?: GooglePlace[] };
  return (payload.places ?? [])
    .filter(isRestaurantPlace)
    .map(fromGooglePlace)
    .filter((item) => item.placeId && item.name);
}

export async function loadHoursAndPhotos<T extends PlaceRestaurant>(places: T[]): Promise<T[]> {
  return Promise.all(
    places.map(async (place) => {
      try {
        const extra = await hoursLoader(place.placeId);
        return {
          ...place,
          photoUrl: extra.photoUrl ?? place.photoUrl,
          hours: extra.hours ?? place.hours,
          openNow: extra.openNow ?? place.openNow ?? null,
          website: extra.website ?? place.website,
          phone: extra.phone ?? place.phone,
          email: extra.email ?? place.email,
          reviews: extra.reviews ?? place.reviews,
          servesVegetarianFood: extra.servesVegetarianFood ?? place.servesVegetarianFood,
          primaryType: extra.primaryType ?? place.primaryType,
        };
      } catch {
        return place;
      }
    }),
  );
}

async function fetchGoogleHoursAndPhoto(placeId: string): Promise<PlaceHoursAndPhoto> {
  const id = placeId.replace(/^places\//, "");
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    headers: placesHeaders([
      "id",
      "regularOpeningHours",
      "photos",
      "websiteUri",
      "nationalPhoneNumber",
      "internationalPhoneNumber",
      "reviews",
      "servesVegetarianFood",
      "primaryType",
    ]),
  });
  if (!response.ok) {
    throw await placesError(response, "Google Places could not load restaurant hours.");
  }
  const place = (await response.json()) as GooglePlace;
  const hours = (place.regularOpeningHours?.weekdayDescriptions ?? []).map((line) => line.trim()).filter(Boolean);
  const photoName = place.photos?.[0]?.name;
  const reviews = (place.reviews ?? [])
    .map((review) => ({
      text: String(review.text?.text ?? "").trim(),
      authorName: review.authorAttribution?.displayName,
      publishedAt: review.publishTime,
    }))
    .filter((review) => review.text);
  return {
    hours: hours.length > 0 ? hours : undefined,
    openNow: place.regularOpeningHours?.openNow ?? null,
    photoUrl: photoName ? await fetchPhotoUri(photoName) : undefined,
    website: place.websiteUri?.trim() || undefined,
    phone: place.nationalPhoneNumber?.trim() || place.internationalPhoneNumber?.trim() || undefined,
    reviews: reviews.length > 0 ? reviews : undefined,
    servesVegetarianFood: place.servesVegetarianFood ?? null,
    primaryType: place.primaryType,
  };
}

async function fetchPhotoUri(photoName: string): Promise<string | undefined> {
  const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  url.searchParams.set("maxHeightPx", "800");
  url.searchParams.set("maxWidthPx", "800");
  url.searchParams.set("skipHttpRedirect", "true");
  const response = await fetch(url, {
    headers: { "X-Goog-Api-Key": placesApiKey() },
  });
  if (!response.ok) {
    return undefined;
  }
  const payload = (await response.json()) as { photoUri?: string };
  return payload.photoUri?.trim() || undefined;
}

export async function geocodeLocation(query: string): Promise<{ latitude: number; longitude: number; address?: string }> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: placesHeaders(["places.id", "places.displayName", "places.formattedAddress", "places.location"]),
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 1,
    }),
  });
  if (!response.ok) {
    throw await placesError(response, "Google Places could not find that location.");
  }
  const payload = (await response.json()) as { places?: GooglePlace[] };
  const place = payload.places?.[0];
  const latitude = place?.location?.latitude;
  const longitude = place?.location?.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw Object.assign(new Error("Google Places could not find that location."), { status: 400 });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw Object.assign(new Error("Google Places returned an invalid location."), { status: 502 });
  }
  return {
    latitude,
    longitude,
    address: place?.formattedAddress,
  };
}

function placesHeaders(fields: string[]): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": placesApiKey(),
    "X-Goog-FieldMask": fields.join(","),
  };
}

async function placesError(response: Response, fallback: string): Promise<Error> {
  const detail = (await response.text()).trim();
  return Object.assign(new Error(detail || fallback), { status: 502 });
}

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  priceLevel?: string;
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  servesVegetarianFood?: boolean;
  goodForChildren?: boolean;
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  photos?: { name?: string }[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  reviews?: Array<{
    text?: { text?: string };
    authorAttribution?: { displayName?: string };
    publishTime?: string;
  }>;
};

export function isRestaurantPlace(place: { primaryType?: string; types?: string[] }): boolean {
  const primary = (place.primaryType ?? "").toLowerCase();
  if (primary === "restaurant" || /_restaurant$/.test(primary)) {
    return true;
  }
  return (place.types ?? []).some((type) => type.toLowerCase() === "restaurant");
}

function fromGooglePlace(place: GooglePlace): PlaceRestaurant {
  return {
    placeId: String(place.id ?? ""),
    name: String(place.displayName?.text ?? "").trim(),
    address: place.formattedAddress,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    priceLevel: place.priceLevel,
    types: place.types,
    primaryType: place.primaryType,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    servesVegetarianFood: place.servesVegetarianFood ?? null,
    goodForChildren: place.goodForChildren ?? null,
  };
}
