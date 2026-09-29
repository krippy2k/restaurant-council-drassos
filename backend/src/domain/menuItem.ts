const MENU_PATHS = ["/menu", "/menus", "/food", "/dinner", "/order"];

const STOP = new Set([
  "the",
  "and",
  "for",
  "have",
  "has",
  "does",
  "what",
  "about",
  "their",
  "this",
  "that",
  "with",
  "from",
  "menu",
  "they",
  "any",
  "are",
  "how",
  "much",
  "item",
]);

export function menuPathCandidates(website: string): string[] {
  try {
    const origin = new URL(website).origin;
    const unique = new Set([website, ...MENU_PATHS.map((path) => new URL(path, origin).toString())]);
    return [...unique];
  } catch {
    return [website];
  }
}

export function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

export function queryAppearsInMenuText(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    const needle = query.toLowerCase().trim();
    return needle.length > 0 && hay.includes(needle);
  }
  return tokens.every((token) => hay.includes(token));
}

export function excerptAroundQuery(text: string, query: string, max = 280): string | undefined {
  const hay = text.toLowerCase();
  const tokens = queryTokens(query);
  let index = -1;
  for (const token of tokens.length > 0 ? tokens : [query.toLowerCase().trim()]) {
    index = hay.indexOf(token);
    if (index >= 0) {
      break;
    }
  }
  if (index < 0) {
    return undefined;
  }
  const start = Math.max(0, index - 80);
  return text.slice(start, start + max).replace(/\s+/g, " ").trim();
}

export function menuConfidence(sourceUrl: string): "confirmed" | "likely" {
  return /\/(menu|menus|food|dinner|order)(\/|$|\?)/i.test(sourceUrl) ? "confirmed" : "likely";
}

export function menuUrlFromOfficialSources(
  sources: Array<{ sourceType: string; sourceUrl: string }>,
): string | undefined {
  return sources.find((item) => item.sourceType === "official-menu")?.sourceUrl;
}
