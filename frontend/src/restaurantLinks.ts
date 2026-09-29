export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function restaurantMenuHref(restaurant: { website?: string; menuUrl?: string }): string | undefined {
  const explicit = restaurant.menuUrl?.trim();
  if (explicit) {
    return explicit;
  }
  const website = restaurant.website?.trim();
  if (!website) {
    return undefined;
  }
  try {
    const parsed = new URL(website);
    if (/\/(menu|menus)(\/|$)/i.test(parsed.pathname)) {
      return website;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
