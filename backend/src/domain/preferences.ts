import { z } from "zod";
import type { Preference, PreferenceCategory, PreferencePriority, PreferenceVisibility } from "./types.js";
import { PREFERENCE_CATEGORIES } from "./types.js";
import { labelForConstraint } from "./commands.js";

const CATEGORIES = new Set<string>(PREFERENCE_CATEGORIES);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function inferPreferenceVisibility(message: string): PreferenceVisibility {
  if (
    /\b(private|confidential|secret|keep\s+(it|this|that)\s+quiet|keep\s+quiet|don'?t\s+tell|do\s+not\s+tell|between\s+us)\b/i.test(
      message,
    )
  ) {
    return "PRIVATE";
  }
  return "PUBLIC";
}

function coerceCategory(value: unknown): PreferenceCategory {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (CATEGORIES.has(raw)) {
    return raw as PreferenceCategory;
  }
  if (raw === "diet" || raw === "gluten" || raw === "gluten-free") {
    return "dietary";
  }
  if (raw === "allergy" || raw === "allergen") {
    return "allergies";
  }
  if (raw === "cost" || raw === "budget") {
    return "price";
  }
  return "freeform";
}

function coercePriority(value: unknown): PreferencePriority {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (raw === "LOW" || raw === "MEDIUM" || raw === "HIGH" || raw === "HARD") {
    return raw;
  }
  if (raw === "REQUIRED" || raw === "MUST" || raw === "NEED") {
    return "HARD";
  }
  if (raw === "PREFERRED" || raw === "PREFER") {
    return "HIGH";
  }
  return "HARD";
}

function coerceVisibility(value: unknown, fallback: PreferenceVisibility): PreferenceVisibility {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (raw === "PRIVATE" || raw === "QUIET" || raw === "SECRET") {
    return "PRIVATE";
  }
  if (raw === "PUBLIC") {
    return "PUBLIC";
  }
  return fallback;
}

function coerceLabel(entry: Record<string, unknown>): string {
  for (const key of ["label", "name", "text", "type"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 80);
    }
  }
  return "";
}

function coerceValue(value: unknown): { type?: string; maxDollars?: number } | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const type = typeof record.type === "string" ? record.type : undefined;
  const maxRaw = record.maxDollars ?? record.max ?? record.budget ?? record.maxPrice;
  const maxDollars = typeof maxRaw === "number" ? maxRaw : Number(maxRaw);
  return {
    ...(type ? { type } : {}),
    ...(Number.isFinite(maxDollars) && maxDollars > 0 ? { maxDollars } : {}),
  };
}

const preferenceItemSchema = z.object({
  category: z.enum(PREFERENCE_CATEGORIES),
  label: z.string().min(1).max(80),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "HARD"]).default("HARD"),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  value: z
    .object({
      type: z.string().min(1).max(40).optional(),
      maxDollars: z.number().min(1).max(1000).optional(),
    })
    .optional(),
});

export const preferenceDraftSchema = z.preprocess((value) => {
  const record = asRecord(value) ?? {};
  const items = Array.isArray(record.constraints)
    ? record.constraints
    : Array.isArray(record.preferences)
      ? record.preferences
      : [];
  const fallbackVisibility = coerceVisibility(record.visibility, "PUBLIC");
  return {
    constraints: items
      .map((item) => {
        const entry = asRecord(item);
        if (!entry) {
          return null;
        }
        const value = coerceValue(entry.value);
        const label = coerceLabel(entry) || (value?.type ? labelForConstraint(value.type) : "");
        if (!label) {
          return null;
        }
        return {
          category: coerceCategory(entry.category),
          label,
          priority: coercePriority(entry.priority),
          visibility: coerceVisibility(entry.visibility, fallbackVisibility),
          ...(value && (value.type || value.maxDollars) ? { value } : {}),
        };
      })
      .filter(Boolean),
  };
}, z.object({ constraints: z.array(preferenceItemSchema).default([]) }));

export type PreferenceDraft = {
  constraints: Array<z.infer<typeof preferenceItemSchema>>;
};

export function fallbackPreferenceDraft(message: string): PreferenceDraft["constraints"] {
  const label = message.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!label) {
    return [];
  }
  return [
    {
      category: "freeform",
      label,
      priority: "HARD",
      visibility: inferPreferenceVisibility(message),
    },
  ];
}

export function draftsFromAgentOutput(draft: PreferenceDraft | undefined, message: string): PreferenceDraft["constraints"] {
  const visibility = inferPreferenceVisibility(message);
  const items = draft?.constraints?.length ? draft.constraints : fallbackPreferenceDraft(message);
  return items.map((item) => ({
    ...item,
    visibility: visibility === "PRIVATE" ? "PRIVATE" : item.visibility,
  }));
}

export function normalizePreferenceDrafts(
  drafts: PreferenceDraft["constraints"],
  input: { id: () => string; eventId: string; userId: string; nowIso: string },
): Preference[] {
  const preferences: Preference[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const category = draft.category;
    const label = draft.label.trim();
    if (!label) {
      continue;
    }
    const type = draft.value?.type?.trim().toLowerCase().replace(/\s+/g, "-");
    const maxDollars = draft.value?.maxDollars;
    const key = `${category}:${type ?? ""}:${maxDollars ?? ""}:${label.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    preferences.push({
      id: input.id(),
      eventId: input.eventId,
      userId: input.userId,
      category,
      visibility: draft.visibility ?? "PUBLIC",
      priority: draft.priority ?? "HARD",
      value: {
        label,
        ...(type ? { type } : {}),
        ...(typeof maxDollars === "number" ? { maxDollars } : {}),
      },
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    });
  }
  return preferences;
}

export function preferenceLabel(preference: Preference): string {
  const value = preference.value ?? {};
  if (typeof value.label === "string" && value.label.trim()) {
    return value.label.trim();
  }
  if (preference.category === "price" && typeof value.maxDollars === "number") {
    return `Under $${value.maxDollars}`;
  }
  if (typeof value.type === "string" && value.type.trim()) {
    return labelForConstraint(value.type);
  }
  return labelForConstraint(preference.category);
}

export function preferencePriorityLabel(priority: PreferencePriority): string {
  if (priority === "HARD") {
    return "Required";
  }
  if (priority === "HIGH") {
    return "Strong preference";
  }
  if (priority === "MEDIUM") {
    return "Preference";
  }
  return "Nice to have";
}
