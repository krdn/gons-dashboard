import { OAuthExpiredError, GoogleApiError, TransientError } from "./errors";

// raw Google Calendar API event shape. shared-google은 정규화하지 않는다 —
// 정규화는 mcp-calendar 도메인 패키지의 책임 (event 모양이 도메인 결정이므로).
export interface RawGoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: unknown;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; responseStatus?: string }>;
}

// calendarList 항목 — 사용자가 접근 가능한 캘린더 메타.
// selected: Google UI에서 켜둔 캘린더만 위젯이 합쳐 보여주기 위한 필터.
export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  selected: boolean;
  accessRole: string;
}

export interface ListUpcomingEventsOptions {
  accessToken: string;
  calendarId: string;
  timeMin: string;  // ISO 8601
  timeMax: string;  // ISO 8601
  maxResults: number;
  fetcher?: typeof fetch;
}

export interface ListUpcomingEventsResult {
  items: RawGoogleEvent[];
}

export async function listUpcomingEvents(
  opts: ListUpcomingEventsOptions,
): Promise<ListUpcomingEventsResult> {
  const { accessToken, calendarId, timeMin, timeMax, maxResults, fetcher = fetch } = opts;
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new TransientError(
      `Calendar API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new OAuthExpiredError(`Calendar API auth failed (${response.status})`);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new TransientError(
      `Calendar API transient (${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new GoogleApiError(
      `Calendar API unexpected ${response.status}`,
      response.status,
    );
  }

  const body = (await response.json()) as { items?: RawGoogleEvent[] };
  return { items: body.items ?? [] };
}

export interface ListCalendarListOptions {
  accessToken: string;
  /** Google API minAccessRole — reader 이면 읽기 가능한 캘린더만. */
  minAccessRole?: "reader" | "writer" | "owner";
  fetcher?: typeof fetch;
}

export interface ListCalendarListResult {
  items: CalendarListEntry[];
}

export async function listCalendarList(
  opts: ListCalendarListOptions,
): Promise<ListCalendarListResult> {
  const { accessToken, minAccessRole = "reader", fetcher = fetch } = opts;
  const params = new URLSearchParams({ minAccessRole });
  const url = `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params.toString()}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new TransientError(
      `CalendarList API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new OAuthExpiredError(`CalendarList API auth failed (${response.status})`);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new TransientError(
      `CalendarList API transient (${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new GoogleApiError(
      `CalendarList API unexpected ${response.status}`,
      response.status,
    );
  }

  const body = (await response.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      primary?: boolean;
      selected?: boolean;
      accessRole?: string;
    }>;
  };
  const items: CalendarListEntry[] = (body.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary ?? c.id,
    primary: Boolean(c.primary),
    selected: Boolean(c.selected),
    accessRole: c.accessRole ?? "reader",
  }));
  return { items };
}
