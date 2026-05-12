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
