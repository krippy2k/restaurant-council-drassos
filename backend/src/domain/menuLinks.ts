import { z } from "zod";

export type PageLink = {
  href: string;
  text: string;
};

const SKIP_PROTOCOLS = /^(mailto|tel|sms|javascript):/i;
const SKIP_HOSTS = /(^|\.)(facebook|instagram|twitter|tiktok|x)\.com$/i;
const MENU_PATH = /\/(menu|menus)(\/|$|\?|#)/i;
const MENU_WORD = /\b(menus?|menú)\b/i;
const WEAK_TEXT = /\b(about|contact|career|job|privacy|gift|reservations?|hours?|location|event|blog|login)\b/i;
const MENU_HOST =
  /(toasttab|popmenu|getbento|menufy|chownow|toastcdn|splickit|thanx|orderest|spoton|olo\.com|eatstreet)/i;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[2] ?? match?.[3] ?? match?.[4];
}

function resolveHref(href: string, baseUrl: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#" || SKIP_PROTOCOLS.test(trimmed)) {
    return undefined;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    const base = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (url.origin === base.origin && url.pathname === base.pathname && url.search === base.search) {
      return undefined;
    }
    url.hash = "";
    if (SKIP_HOSTS.test(url.hostname) && !MENU_WORD.test(url.pathname + url.search)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function extractPageLinks(html: string, baseUrl: string): PageLink[] {
  const seen = new Set<string>();
  const links: PageLink[] = [];
  const tag = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    const href = attribute(match[1] ?? "", "href");
    if (!href) {
      continue;
    }
    const resolved = resolveHref(href, baseUrl);
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    const text = decodeEntities((match[2] ?? "").replace(/<[^>]+>/g, " "));
    links.push({ href: resolved, text });
  }
  return links;
}

function scoreMenuLink(link: PageLink): number {
  const blob = `${link.href} ${link.text}`;
  if (WEAK_TEXT.test(link.text) && !MENU_WORD.test(blob)) {
    return 0;
  }
  let score = 0;
  if (MENU_PATH.test(link.href) || MENU_WORD.test(link.text)) {
    score += 5;
  }
  if (MENU_WORD.test(link.href)) {
    score += 3;
  }
  if (MENU_HOST.test(link.href)) {
    score += 4;
  }
  if (/\.(pdf)(\?|$)/i.test(link.href) && MENU_WORD.test(blob)) {
    score += 2;
  }
  return score;
}

export function heuristicMenuUrl(links: PageLink[], website?: string): string | undefined {
  const site = website?.trim();
  if (site && MENU_PATH.test(site)) {
    return site;
  }
  const ranked = links
    .map((link) => ({ link, score: scoreMenuLink(link) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.link.href;
}

export function linksForMenuAgent(links: PageLink[], limit = 40): PageLink[] {
  return [...links]
    .sort((left, right) => scoreMenuLink(right) - scoreMenuLink(left))
    .slice(0, limit);
}

const menuPickSchema = z.object({
  placeId: z.string().min(1),
  menuUrl: z.string().min(8),
});

export const menuLinksDraftSchema = z.preprocess((value) => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const menus = Array.isArray(record.menus) ? record.menus : [];
  return { menus };
}, z.object({ menus: z.array(menuPickSchema).default([]) }));

export type MenuLinksDraft = {
  menus: Array<{ placeId: string; menuUrl: string }>;
};

export function applyMenuLinkPicks<T extends { placeId: string; menuUrl?: string }>(
  restaurants: T[],
  draft: MenuLinksDraft,
  allowed: Map<string, Set<string>> | Record<string, string[]>,
): T[] {
  const chosen = new Map<string, string>();
  for (const item of draft.menus ?? []) {
    const permit = allowed instanceof Map ? allowed.get(item.placeId) : allowed[item.placeId];
    const ok = permit instanceof Set ? permit.has(item.menuUrl) : Boolean(permit?.includes(item.menuUrl));
    if (!ok) {
      continue;
    }
    chosen.set(item.placeId, item.menuUrl);
  }
  return restaurants.map((restaurant) => {
    const menuUrl = chosen.get(restaurant.placeId) ?? restaurant.menuUrl;
    return menuUrl ? { ...restaurant, menuUrl } : restaurant;
  });
}
