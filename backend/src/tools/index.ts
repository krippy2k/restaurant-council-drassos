export {
  eventChat,
  eventChatInputSchema,
  eventChatOutputSchema,
  type EventChatToolInput,
  type EventChatToolOutput,
} from "./chat.js";
export {
  checkMenuItem,
  checkMenuItemInputSchema,
  checkMenuItemOutputSchema,
  setMenuPageFetcher,
  type CheckMenuItemInput,
  type CheckMenuItemOutput,
} from "./checkMenuItem.js";
export {
  lookupRestaurantHours,
  lookupRestaurantHoursInputSchema,
  lookupRestaurantHoursOutputSchema,
  type LookupRestaurantHoursInput,
  type LookupRestaurantHoursOutput,
} from "./lookupRestaurantHours.js";
import { eventChat } from "./chat.js";
import { checkMenuItem } from "./checkMenuItem.js";
import { lookupRestaurantHours } from "./lookupRestaurantHours.js";

export const councilTools = [eventChat, checkMenuItem, lookupRestaurantHours];
