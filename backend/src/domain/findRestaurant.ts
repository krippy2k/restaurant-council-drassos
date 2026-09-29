export type NamedRestaurant = {
  placeId: string;
  name: string;
};

const APOSTROPHES = /[\u2018\u2019\u201A\u201B\u2032\uFF07']/g;

export function normalizeRestaurantName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(APOSTROPHES, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function findRestaurantByNameOrId<T extends NamedRestaurant>(
  restaurants: T[],
  query: string,
): T | undefined {
  const raw = query.trim();
  if (!raw) {
    return undefined;
  }
  const byId = restaurants.find((item) => item.placeId === raw);
  if (byId) {
    return byId;
  }
  const needle = normalizeRestaurantName(raw);
  if (!needle) {
    return undefined;
  }
  const exact = restaurants.filter((item) => normalizeRestaurantName(item.name) === needle);
  if (exact.length === 1) {
    return exact[0];
  }
  const contained = restaurants.filter((item) => {
    const name = normalizeRestaurantName(item.name);
    return name.includes(needle) || needle.includes(name);
  });
  if (contained.length === 1) {
    return contained[0];
  }
  const scored = contained
    .map((item) => ({ item, len: normalizeRestaurantName(item.name).length }))
    .sort((left, right) => left.len - right.len);
  return scored[0]?.item;
}

const GENERIC_NAME_TOKENS = new Set([
  "bar",
  "cafe",
  "diner",
  "food",
  "grill",
  "house",
  "kitchen",
  "pizza",
  "restaurant",
  "winery",
  "and",
]);

function distinctiveNameTokens(name: string): string[] {
  return name.split(" ").filter((token) => token.length > 2 && !GENERIC_NAME_TOKENS.has(token));
}

export function restaurantsMentionedInText<T extends NamedRestaurant>(restaurants: T[], text: string): T[] {
  const haystack = normalizeRestaurantName(text);
  if (!haystack) {
    return [];
  }
  const hayTokens = new Set(haystack.split(" ").filter(Boolean));
  const hits: T[] = [];
  for (const restaurant of restaurants) {
    const name = normalizeRestaurantName(restaurant.name);
    if (!name) {
      continue;
    }
    if (haystack.includes(name) || name.includes(haystack)) {
      hits.push(restaurant);
      continue;
    }
    const tokens = distinctiveNameTokens(name);
    if (tokens.length >= 1 && tokens.every((token) => hayTokens.has(token) || haystack.includes(token))) {
      hits.push(restaurant);
      continue;
    }
    const uniqueTokens = tokens.filter(
      (token) => restaurants.filter((item) => distinctiveNameTokens(normalizeRestaurantName(item.name)).includes(token)).length === 1,
    );
    if (uniqueTokens.some((token) => hayTokens.has(token))) {
      hits.push(restaurant);
    }
  }
  return hits;
}
