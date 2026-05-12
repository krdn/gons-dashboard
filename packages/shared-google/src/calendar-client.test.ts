import { describe, expect, it, vi } from "vitest";
import { listCalendarList, listUpcomingEvents } from "./calendar-client";
import { OAuthExpiredError, TransientError } from "./errors";

const accessToken = "ya29.test";

describe("listUpcomingEvents", () => {
  it("sends singleEvents=true and orderBy=startTime", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await listUpcomingEvents({
      accessToken,
      calendarId: "primary",
      timeMin: "2026-05-12T00:00:00.000Z",
      timeMax: "2026-05-13T00:00:00.000Z",
      maxResults: 5,
      fetcher,
    });
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("orderBy=startTime");
    expect(url).toContain("maxResults=5");
    expect(url).toContain("calendars/primary/events");
  });

  it("URL-encodes timeMin/timeMax", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    await listUpcomingEvents({
      accessToken,
      calendarId: "primary",
      timeMin: "2026-05-12T00:00:00.000Z",
      timeMax: "2026-05-13T00:00:00.000Z",
      maxResults: 5,
      fetcher,
    });
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toMatch(/timeMin=2026-05-12T00%3A00%3A00\.000Z/);
  });

  it("throws OAuthExpiredError on 401", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(
      listUpcomingEvents({
        accessToken,
        calendarId: "primary",
        timeMin: "2026-05-12T00:00:00.000Z",
        timeMax: "2026-05-13T00:00:00.000Z",
        maxResults: 5,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(OAuthExpiredError);
  });

  it("throws TransientError on 503", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(
      listUpcomingEvents({
        accessToken,
        calendarId: "primary",
        timeMin: "2026-05-12T00:00:00.000Z",
        timeMax: "2026-05-13T00:00:00.000Z",
        maxResults: 5,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("returns raw items array on 200", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { id: "abc", summary: "Test", start: { dateTime: "2026-05-12T05:00:00Z" } },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await listUpcomingEvents({
      accessToken,
      calendarId: "primary",
      timeMin: "2026-05-12T00:00:00.000Z",
      timeMax: "2026-05-13T00:00:00.000Z",
      maxResults: 5,
      fetcher,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("abc");
  });
});

describe("listCalendarList", () => {
  it("calls calendarList endpoint with minAccessRole=reader by default", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    await listCalendarList({ accessToken, fetcher });
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain("/users/me/calendarList");
    expect(url).toContain("minAccessRole=reader");
  });

  it("normalizes entries, defaulting primary/selected to false", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { id: "primary-id", summary: "개발업무", primary: true, selected: true, accessRole: "owner" },
            { id: "secondary-id", summary: "개인일정", selected: true, accessRole: "owner" },
            { id: "hidden-id", summary: "보관용", accessRole: "owner" },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await listCalendarList({ accessToken, fetcher });
    expect(result.items).toEqual([
      { id: "primary-id", summary: "개발업무", primary: true, selected: true, accessRole: "owner" },
      { id: "secondary-id", summary: "개인일정", primary: false, selected: true, accessRole: "owner" },
      { id: "hidden-id", summary: "보관용", primary: false, selected: false, accessRole: "owner" },
    ]);
  });

  it("throws OAuthExpiredError on 401", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(listCalendarList({ accessToken, fetcher })).rejects.toBeInstanceOf(
      OAuthExpiredError,
    );
  });

  it("throws TransientError on 503", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(listCalendarList({ accessToken, fetcher })).rejects.toBeInstanceOf(
      TransientError,
    );
  });
});
