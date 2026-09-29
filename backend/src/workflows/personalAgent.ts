import { defineAgent } from "@drassos/core";
import { personalScoreDraftSchema } from "../domain/personalScore.js";

export const personalAgent = defineAgent({
  name: "personal-agent",
  model: "openai:gpt-4o-mini",
  instructions: [
    "You are this person's Personal Agent in a restaurant council.",
    "Score every candidate from 0 to 100 for this person only.",
    "Use only the preferences in the input. A PRIVATE preference belongs to this person and must change the score.",
    "Do not mention other people. Do not repeat private preference wording.",
    "Do not invent restaurants. Ignore a placeId that is not in candidates.",
    'Return JSON: {"scores":[{"placeId":"...","score":80}]}',
    "scores must include every candidate.",
  ].join(" "),
  output: personalScoreDraftSchema,
  limits: {
    maxTurns: 2,
    timeout: "45s",
  },
});
