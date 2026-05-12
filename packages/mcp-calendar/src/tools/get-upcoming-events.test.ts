import { describe, expect, it, vi } from "vitest";
import { makeGetUpcomingEventsTool } from "./get-upcoming-events";

describe("getUpcomingEvents tool", () => {
  const baseEvent = {
    id: "e1",
    summary: "Test",
    start: { dateTime: "2026-05-12T05:00:00Z" },
    end: { dateTime: "2026-05-12T06:00:00Z" },
    htmlLink: "https://calendar.google.com/?x",
  };

  it("composes accessToken + calendar API, returns CalendarEvent[]", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("ya29.test");
    const listFn = vi.fn().mockResolvedValue({ items: [baseEvent] });
    const tool = makeGetUpcomingEventsTool({
      getAccessToken,
      listFn,
      now: () => new Date("2026-05-12T00:00:00Z"),
    });
    const result = await tool.handler({ withinHours: 24, limit: 5, calendarId: "primary" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe("e1");
    expect(result.events[0].title).toBe("Test");
    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(listFn).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "ya29.test",
        calendarId: "primary",
        maxResults: 5,
      }),
    );
  });

  it("uses now + withinHours for timeMin/timeMax", async () => {
    const listFn = vi.fn().mockResolvedValue({ items: [] });
    const tool = makeGetUpcomingEventsTool({
      getAccessToken: async () => "ya29",
      listFn,
      now: () => new Date("2026-05-12T00:00:00Z"),
    });
    await tool.handler({ withinHours: 24, limit: 10, calendarId: "primary" });
    const call = listFn.mock.calls[0][0];
    expect(call.timeMin).toBe("2026-05-12T00:00:00.000Z");
    expect(call.timeMax).toBe("2026-05-13T00:00:00.000Z");
  });

  it("applies defaults (withinHours=24, limit=10, calendarId='primary')", async () => {
    const listFn = vi.fn().mockResolvedValue({ items: [] });
    const tool = makeGetUpcomingEventsTool({
      getAccessToken: async () => "ya29",
      listFn,
      now: () => new Date("2026-05-12T00:00:00Z"),
    });
    await tool.handler({} as never);
    const call = listFn.mock.calls[0][0];
    expect(call.maxResults).toBe(10);
    expect(call.calendarId).toBe("primary");
  });

  it("returns fetchedAt as ISO from now()", async () => {
    const tool = makeGetUpcomingEventsTool({
      getAccessToken: async () => "ya29",
      listFn: async () => ({ items: [] }),
      now: () => new Date("2026-05-12T07:30:00Z"),
    });
    const result = await tool.handler({ withinHours: 24, limit: 10, calendarId: "primary" });
    expect(result.fetchedAt).toBe("2026-05-12T07:30:00.000Z");
  });

  it("accepts withinHours up to 336 (2 weeks) and rejects beyond", async () => {
    const tool = makeGetUpcomingEventsTool({
      getAccessToken: async () => "ya29",
      listFn: async () => ({ items: [] }),
      now: () => new Date(),
    });
    await expect(
      tool.handler({ withinHours: 336, limit: 10, calendarId: "primary" }),
    ).resolves.toBeDefined();
    await expect(
      tool.handler({ withinHours: 337, limit: 10, calendarId: "primary" }),
    ).rejects.toThrow();
  });
});
