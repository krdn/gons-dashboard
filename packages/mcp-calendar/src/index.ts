export { CalendarEventSchema } from "./domain/event";
export type { CalendarEvent } from "./domain/event";
export { normalizeEvent } from "./domain/normalize-event";
export { makeGetUpcomingEventsTool } from "./tools/get-upcoming-events";
export type {
  MakeGetUpcomingEventsToolDeps,
  GetUpcomingEventsTool,
} from "./tools/get-upcoming-events";
