import { z } from "zod";
import { defineTool } from "@gons/shared-mcp-runtime";
import type {
  ListUpcomingEventsOptions,
  ListUpcomingEventsResult,
} from "@gons/shared-google";
import { CalendarEventSchema } from "../domain/event";
import { normalizeEvent } from "../domain/normalize-event";

const InputSchema = z.object({
  withinHours: z.number().int().min(1).max(336).default(24),
  limit: z.number().int().min(1).max(50).default(10),
  calendarId: z.string().default("primary"),
});

const OutputSchema = z.object({
  events: z.array(CalendarEventSchema),
  fetchedAt: z.string().datetime(),
});

export interface MakeGetUpcomingEventsToolDeps {
  /** mediator에서 access token을 받아오는 함수. in-process vs stdio가 주입. */
  getAccessToken: () => Promise<string>;
  /** Google Calendar API 호출. 보통 shared-google의 listUpcomingEvents 그대로. */
  listFn: (opts: ListUpcomingEventsOptions) => Promise<ListUpcomingEventsResult>;
  /** Clock injection — 테스트 편의. 기본은 () => new Date(). */
  now?: () => Date;
}

export function makeGetUpcomingEventsTool(deps: MakeGetUpcomingEventsToolDeps) {
  const now = deps.now ?? (() => new Date());
  return defineTool({
    name: "calendar.getUpcomingEvents",
    description:
      "다음 N시간(기본 24h, 최대 336h=2주)의 Google Calendar 일정을 시작 시각 오름차순으로 반환합니다. 반복 일정은 인스턴스로 펼쳐집니다.",
    input: InputSchema,
    output: OutputSchema,
    handler: async (input) => {
      const withinHours: number = input.withinHours ?? 24;
      const limit: number = input.limit ?? 10;
      const calendarId: string = input.calendarId ?? "primary";
      const accessToken = await deps.getAccessToken();
      const nowMs = now().getTime();
      const timeMin = new Date(nowMs).toISOString();
      const timeMax = new Date(nowMs + withinHours * 60 * 60 * 1000).toISOString();
      const result = await deps.listFn({
        accessToken,
        calendarId,
        timeMin,
        timeMax,
        maxResults: limit,
      });
      return {
        events: result.items.map(normalizeEvent),
        fetchedAt: new Date(nowMs).toISOString(),
      };
    },
  });
}

export type GetUpcomingEventsTool = ReturnType<typeof makeGetUpcomingEventsTool>;
