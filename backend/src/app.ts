import { defineApp, type ModelProvider } from "@drassos/core";
import { OpenAIAgentProvider } from "@drassos/node";
import { addContactWorkflow } from "./workflows/addContact.js";
import { addEventPreferencesWorkflow, interpretPreferencesAgent } from "./workflows/addEventPreferences.js";
import { createEventWorkflow, interpretEventAgent } from "./workflows/createEvent.js";
import { deleteEventWorkflow } from "./workflows/deleteEvent.js";
import { inviteToEventWorkflow } from "./workflows/inviteToEvent.js";
import { loginUserWorkflow } from "./workflows/loginUser.js";
import { logoutUserWorkflow } from "./workflows/logoutUser.js";
import { registerUserWorkflow } from "./workflows/registerUser.js";
import { findMenuLinksAgent } from "./workflows/findMenuLinks.js";
import { negotiateCouncilAgent } from "./workflows/negotiator.js";
import { personalAgent } from "./workflows/personalAgent.js";
import { startCouncilWorkflow } from "./workflows/startCouncil.js";
import { decideRestaurantWorkflow } from "./workflows/decideRestaurant.js";
import { agentChatRequestWorkflow, councilChatAgent } from "./workflows/agentChat.js";
import { updateEventWorkflow } from "./workflows/updateEvent.js";
import { councilTools } from "./tools/index.js";

export function openaiModelsFromEnv(): Record<string, ModelProvider> | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }
  return {
    openai: new OpenAIAgentProvider({
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
    }),
  };
}

export function createCouncilApp(options?: { models?: Record<string, ModelProvider> }) {
  const models = options?.models ?? openaiModelsFromEnv();
  return defineApp({
    workflows: [
      createEventWorkflow,
      updateEventWorkflow,
      deleteEventWorkflow,
      registerUserWorkflow,
      loginUserWorkflow,
      logoutUserWorkflow,
      inviteToEventWorkflow,
      addContactWorkflow,
      addEventPreferencesWorkflow,
      startCouncilWorkflow,
      decideRestaurantWorkflow,
      agentChatRequestWorkflow,
    ],
    agents: [
      interpretEventAgent,
      interpretPreferencesAgent,
      findMenuLinksAgent,
      personalAgent,
      negotiateCouncilAgent,
      councilChatAgent,
    ],
    tools: councilTools,
    models,
  });
}

export default createCouncilApp();
