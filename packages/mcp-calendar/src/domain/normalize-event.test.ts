import { describe, expect, it } from "vitest";
import { normalizeEvent } from "./normalize-event";

describe("normalizeEvent", () => {
  it("normalizes a dateTime event", () => {
    const raw = {
      id: "evt-1",
      summary: "디자인 리뷰",
      start: { dateTime: "2026-05-12T05:00:00Z" },
      end: { dateTime: "2026-05-12T06:00:00Z" },
      location: "Meeting Room A",
      htmlLink: "https://calendar.google.com/calendar/event?eid=abc",
      attendees: [
        { email: "alice@example.com", responseStatus: "accepted" },
        { email: "bob@example.com" },
      ],
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    };
    const ev = normalizeEvent(raw, { calendarId: "primary", calendarSummary: "개발업무" });
    expect(ev.id).toBe("evt-1");
    expect(ev.calendarId).toBe("primary");
    expect(ev.calendarSummary).toBe("개발업무");
    expect(ev.title).toBe("디자인 리뷰");
    expect(ev.startAt).toBe("2026-05-12T05:00:00.000Z");
    expect(ev.endAt).toBe("2026-05-12T06:00:00.000Z");
    expect(ev.allDay).toBe(false);
    expect(ev.location).toBe("Meeting Room A");
    expect(ev.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(ev.attendees).toEqual([
      { email: "alice@example.com", responseStatus: "accepted" },
      { email: "bob@example.com", responseStatus: null },
    ]);
    expect(ev.htmlLink).toBe("https://calendar.google.com/calendar/event?eid=abc");
  });

  it("marks allDay events with date-only start", () => {
    const raw = {
      id: "evt-2",
      summary: "휴가",
      start: { date: "2026-05-13" },
      end: { date: "2026-05-14" },
      htmlLink: "https://calendar.google.com/calendar/event?eid=xyz",
    };
    const ev = normalizeEvent(raw, { calendarId: "primary", calendarSummary: "개발업무" });
    expect(ev.allDay).toBe(true);
    expect(ev.startAt).toBe("2026-05-13T00:00:00.000Z");
    expect(ev.endAt).toBe("2026-05-14T00:00:00.000Z");
  });

  it("uses '(제목 없음)' when summary is missing", () => {
    const raw = {
      id: "evt-3",
      start: { dateTime: "2026-05-12T05:00:00Z" },
      end: { dateTime: "2026-05-12T06:00:00Z" },
      htmlLink: "https://calendar.google.com/?x",
    };
    const ev = normalizeEvent(raw, { calendarId: "primary", calendarSummary: "개발업무" });
    expect(ev.title).toBe("(제목 없음)");
  });

  it("returns null for missing location/meetingUrl/attendees", () => {
    const raw = {
      id: "evt-4",
      summary: "혼자 작업",
      start: { dateTime: "2026-05-12T05:00:00Z" },
      end: { dateTime: "2026-05-12T06:00:00Z" },
      htmlLink: "https://calendar.google.com/?y",
    };
    const ev = normalizeEvent(raw, { calendarId: "primary", calendarSummary: "개발업무" });
    expect(ev.location).toBeNull();
    expect(ev.meetingUrl).toBeNull();
    expect(ev.attendees).toEqual([]);
  });
});
