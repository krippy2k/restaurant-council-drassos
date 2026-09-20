import type { Preference } from "./types.js";
import { preferenceLabel } from "./preferences.js";

export const KNOWN_DIETARY_REQUIREMENTS = [
  "dairy-free",
  "gluten-free",
  "vegetarian",
  "vegan",
  "nut-free",
  "peanut-free",
  "shellfish-free",
  "egg-free",
  "soy-free",
  "halal",
  "kosher",
] as const;

export type DietaryAssessmentStatus = "confirmed" | "likely" | "uncertain" | "unsupported" | "conflicting";

export type DietaryEvidence = {
  id: string;
  sourceType:
    | "structured-provider"
    | "official-menu"
    | "official-website"
    | "review"
    | "other";
  sourceUrl?: string;
  sourceName?: string;
  excerpt?: string;
  supports: "supports" | "contradicts" | "neutral";
  reliability: "high" | "medium" | "low";
};

export type DietaryAssessment = {
  restaurantId: string;
  requirement: string;
  status: DietaryAssessmentStatus;
  confidence: number;
  evidence: DietaryEvidence[];
};

const REQUIREMENT_ALIASES: Record<string, string> = {
  dairy: "dairy-free",
  "dairy free": "dairy-free",
  dairyfree: "dairy-free",
  "lactose-free": "dairy-free",
  lactose: "dairy-free",
  milk: "dairy-free",
  gluten: "gluten-free",
  "gluten free": "gluten-free",
  glutenfree: "gluten-free",
  gf: "gluten-free",
  celiac: "gluten-free",
  veggie: "vegetarian",
  vegetarian: "vegetarian",
  vegan: "vegan",
  "nut free": "nut-free",
  nuts: "nut-free",
  peanut: "peanut-free",
  peanuts: "peanut-free",
  "peanut free": "peanut-free",
  shellfish: "shellfish-free",
  egg: "egg-free",
  eggs: "egg-free",
  soy: "soy-free",
  halal: "halal",
  kosher: "kosher",
};

export function normalizeDietaryRequirement(value: string): string | null {
  const key = value.trim().toLowerCase().replaceAll("_", "-");
  if (!key || key.length > 40) {
    return null;
  }
  const mapped = REQUIREMENT_ALIASES[key] ?? key;
  if (REQUIREMENT_ALIASES[mapped]) {
    return REQUIREMENT_ALIASES[mapped];
  }
  if ((KNOWN_DIETARY_REQUIREMENTS as readonly string[]).includes(mapped)) {
    return mapped;
  }
  if (mapped.endsWith("-free") && /^[a-z][a-z0-9-]{1,38}$/.test(mapped)) {
    return mapped;
  }
  return null;
}

export function dietaryRequirementForPreference(preference: Preference): string | null {
  const type = String(preference.value?.type ?? "");
  const label = preferenceLabel(preference);
  const fromType = normalizeDietaryRequirement(type);
  if (fromType) {
    return fromType;
  }
  const fromLabel = normalizeDietaryRequirement(label);
  if (fromLabel) {
    return fromLabel;
  }
  if (preference.category === "allergies" || preference.category === "dietary") {
    return normalizeDietaryRequirement(`${label}-free`) ?? normalizeDietaryRequirement(label.replace(/\s+allergy$/i, ""));
  }
  return null;
}

export function dietaryRequirementsFromPreferences(preferences: Preference[]): string[] {
  return [...new Set(preferences.map(dietaryRequirementForPreference).filter((item): item is string => Boolean(item)))];
}

export function clipExcerpt(text: string, max = 240): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

export function extractDietarySignals(
  text: string,
  requirement: string,
): Array<{ supports: DietaryEvidence["supports"]; excerpt: string }> {
  if (!text.trim()) {
    return [];
  }
  const signals: Array<{ supports: DietaryEvidence["supports"]; excerpt: string }> = [];
  const push = (supports: DietaryEvidence["supports"], excerpt: string) => {
    signals.push({ supports, excerpt: clipExcerpt(excerpt) });
  };

  if (requirement === "dairy-free") {
    if (/\b(cannot|can't|unable to|no dairy[- ]free|don't have dairy[- ]free)\b/i.test(text)) {
      push("contradicts", excerptAround(text, /cannot|can't|unable|no dairy|don't have/i));
    } else if (
      /\b(df|dairy[- ]free|lactose[- ]free)\b/i.test(text) &&
      /\b(menu|options?|dishes?|available|marked)\b/i.test(text)
    ) {
      push("supports", excerptAround(text, /df|dairy[- ]free|lactose[- ]free/i));
    }
    if (/\bvegan\b/i.test(text) && /\b(menu|options?|dishes?|available|marked)\b/i.test(text)) {
      push("supports", excerptAround(text, /vegan/i));
    }
  }

  if (requirement === "gluten-free") {
    if (/\b(cannot|can't|unable to) (accommodate|offer|make) gluten/i.test(text)) {
      push("contradicts", excerptAround(text, /cannot|can't|unable/i));
    }
    if (
      /\b(gf|gluten[- ]free)\b/i.test(text) &&
      /\b(menu|options?|dishes?|available|kitchen|meal|accommodat)\b/i.test(text)
    ) {
      push("supports", excerptAround(text, /gf|gluten[- ]free/i));
    }
    if (/\bcross[- ]contact\b/i.test(text) || /\bshared fryer\b/i.test(text)) {
      push("contradicts", excerptAround(text, /cross[- ]contact|shared fryer/i));
    }
  }

  if (requirement === "vegetarian" && /\bvegetarian\b/i.test(text)) {
    push("supports", excerptAround(text, /vegetarian/i));
  }
  if (requirement === "vegan" && /\bvegan\b/i.test(text)) {
    push("supports", excerptAround(text, /vegan/i));
  }
  if (requirement === "nut-free" && /\bnut[- ]free\b/i.test(text)) {
    push("supports", excerptAround(text, /nut[- ]free/i));
  }
  if (requirement === "peanut-free" && /\bpeanut[- ]free\b/i.test(text)) {
    push("supports", excerptAround(text, /peanut[- ]free/i));
  }
  return signals;
}

function excerptAround(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match || match.index == null) {
    return clipExcerpt(text);
  }
  const start = Math.max(0, match.index - 60);
  return clipExcerpt(text.slice(start, start + 180));
}

export function evidenceFromText(input: {
  text: string;
  requirement: string;
  sourceType: DietaryEvidence["sourceType"];
  sourceUrl?: string;
  sourceName?: string;
  reliability: DietaryEvidence["reliability"];
}): DietaryEvidence[] {
  return extractDietarySignals(input.text, input.requirement).map((signal) => ({
    id: crypto.randomUUID(),
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    sourceName: input.sourceName,
    excerpt: signal.excerpt,
    supports: signal.supports,
    reliability: input.reliability,
  }));
}

export function assessDietaryEvidence(input: {
  restaurantId: string;
  requirement: string;
  evidence: DietaryEvidence[];
}): DietaryAssessment {
  const evidence = [...input.evidence];
  const supporting = evidence.filter((item) => item.supports === "supports");
  const contradicting = evidence.filter((item) => item.supports === "contradicts");
  const official = (item: DietaryEvidence) =>
    item.sourceType === "official-menu" ||
    item.sourceType === "official-website" ||
    item.sourceType === "structured-provider";
  const officialSupport = supporting.filter(official);
  const officialContradict = contradicting.filter(official);
  const reviewSupport = supporting.filter((item) => item.sourceType === "review");
  const highOfficial = officialSupport.filter((item) => item.reliability === "high");

  let status: DietaryAssessmentStatus = "uncertain";
  let confidence = 0.35;
  if (evidence.length === 0) {
    status = "uncertain";
    confidence = 0.2;
  } else if (officialContradict.length && officialSupport.length) {
    status = "conflicting";
    confidence = 0.45;
  } else if (officialContradict.length && reviewSupport.length) {
    status = "conflicting";
    confidence = 0.4;
  } else if (officialContradict.length) {
    status = "unsupported";
    confidence = 0.8;
  } else if (contradicting.length && supporting.length) {
    status = "conflicting";
    confidence = 0.42;
  } else if (highOfficial.length) {
    status = "confirmed";
    confidence = 0.92;
  } else if (officialSupport.length) {
    status = "confirmed";
    confidence = 0.84;
  } else if (reviewSupport.length >= 2) {
    status = "likely";
    confidence = 0.62;
  } else if (reviewSupport.length === 1) {
    status = "uncertain";
    confidence = 0.38;
  } else if (supporting.length) {
    status = "uncertain";
    confidence = 0.4;
  }

  return {
    restaurantId: input.restaurantId,
    requirement: input.requirement,
    status,
    confidence,
    evidence,
  };
}

export function scoreFromDietaryAssessment(assessment: DietaryAssessment | undefined): number {
  if (!assessment || assessment.status === "uncertain" || assessment.status === "conflicting") {
    return 50;
  }
  if (assessment.status === "unsupported") {
    return 0;
  }
  return 100;
}

export function assessmentIsUnsupported(assessment: DietaryAssessment | undefined): boolean {
  return assessment?.status === "unsupported";
}
