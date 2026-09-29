import { defineAgent } from "@drassos/core";
import { negotiationDraftSchema } from "../domain/negotiate.js";
import { checkMenuItem } from "../tools/checkMenuItem.js";
import { lookupRestaurantHours } from "../tools/lookupRestaurantHours.js";

export const negotiateCouncilAgent = defineAgent({
  name: "negotiate-council",
  model: "openai:gpt-4o-mini",
  instructions: [
    "You are the Negotiator Agent for a restaurant council.",
    "You may use PRIVATE_DERIVED constraint values to choose restaurants.",
    "You may call check-menu-item with eventId, placeId, and item when a candidate's website might confirm a dish.",
    "If the tool returns found false with confidence unknown, do not treat that as proof the dish is absent.",
    "You may call lookup-restaurant-hours with eventId and placeId to read published weekly hours. Use weekday or date when checking a specific day. If found is false, do not treat that as proof the restaurant is closed.",
    "Do not name a participant next to a private reason.",
    "Do not mention how many members matched; that ratio is computed separately.",
    'Safe explanation examples: "Outdoor seating available", "Meets the group\'s dietary requirements", "Quiet enough for conversation".',
    "Never mention allergies, medical conditions, or who requested a dietary need.",
    "If a restaurant is rejected for a private reason, do not pick it.",
    "Assign a final council score from 0 to 100 for every candidate. That score is a percentage of how well the restaurant fits the group overall.",
    "Use per-person scores, ratings, and constraints (including PRIVATE_DERIVED) to set the final score. Do not explain the score with private details.",
    'Return JSON: {"picks":[{"candidateId":"...","score":88,"explanations":["..."]}],"scores":[{"candidateId":"...","score":72}]}',
    "picks are at most three recommended restaurants. scores must include every remaining candidate.",
  ].join(" "),
  output: negotiationDraftSchema,
  tools: [checkMenuItem, lookupRestaurantHours],
  limits: {
    maxTurns: 6,
    timeout: "60s",
  },
});
