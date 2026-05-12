import type { RawGoogleEvent } from "@gons/shared-google";
import type { CalendarEvent } from "./event";

const ATTENDEE_STATUSES = new Set([
  "accepted",
  "declined",
  "tentative",
  "needsAction",
] as const);

export interface CalendarMeta {
  calendarId: string;
  calendarSummary: string;
}

export function normalizeEvent(
  raw: RawGoogleEvent,
  meta: CalendarMeta,
): CalendarEvent {
  const allDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  const startAt = toIsoUtc(raw.start?.dateTime ?? raw.start?.date);
  const endAt = toIsoUtc(raw.end?.dateTime ?? raw.end?.date);

  return {
    id: raw.id,
    calendarId: meta.calendarId,
    calendarSummary: meta.calendarSummary,
    title: raw.summary?.trim() || "(제목 없음)",
    startAt,
    endAt,
    allDay,
    location: raw.location ?? null,
    attendees:
      raw.attendees?.map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus && (ATTENDEE_STATUSES as Set<string>).has(a.responseStatus)
          ? (a.responseStatus as CalendarEvent["attendees"][number]["responseStatus"])
          : null,
      })) ?? [],
    meetingUrl: raw.hangoutLink ?? null,
    htmlLink: raw.htmlLink ?? "",
  };
}

function toIsoUtc(value: string | undefined): string {
  if (!value) {
    return "1970-01-01T00:00:00.000Z";
  }
  return new Date(value).toISOString();
}
