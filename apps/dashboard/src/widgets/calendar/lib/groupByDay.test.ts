import { describe, expect, it } from "vitest";
import { groupByDay } from "./groupByDay";
import type { CalendarEvent } from "@gons/mcp-calendar";

function event(id: string, startUtc: string): CalendarEvent {
  return {
    id,
    title: `evt-${id}`,
    startAt: startUtc,
    endAt: startUtc,
    allDay: false,
    location: null,
    attendees: [],
    meetingUrl: null,
    htmlLink: "https://calendar.google.com/?x",
  };
}

describe("groupByDay", () => {
  const nowKstMidnight = new Date("2026-05-12T06:00:00Z"); // KST 2026-05-12 15:00 — 12일 오후

  it("buckets events into today and tomorrow based on KST date", () => {
    const events: CalendarEvent[] = [
      event("a", "2026-05-12T05:00:00Z"), // KST 14:00 today
      event("b", "2026-05-12T20:00:00Z"), // KST 05:00 tomorrow (5/13)
    ];
    const result = groupByDay(events, nowKstMidnight);
    expect(result.today.map((e) => e.id)).toEqual(["a"]);
    expect(result.tomorrow.map((e) => e.id)).toEqual(["b"]);
  });

  it("returns empty buckets when no events", () => {
    const result = groupByDay([], nowKstMidnight);
    expect(result.today).toEqual([]);
    expect(result.tomorrow).toEqual([]);
  });

  it("places events beyond tomorrow into neither bucket", () => {
    const events: CalendarEvent[] = [event("far", "2026-05-15T00:00:00Z")];
    const result = groupByDay(events, nowKstMidnight);
    expect(result.today).toEqual([]);
    expect(result.tomorrow).toEqual([]);
  });
});
