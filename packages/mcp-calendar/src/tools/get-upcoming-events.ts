import { z } from "zod";
import { defineTool } from "@gons/shared-mcp-runtime";
import type {
  ListUpcomingEventsOptions,
  ListUpcomingEventsResult,
} from "@gons/shared-google";
import { CalendarEventSchema } from "../domain/event";
import { normalizeEvent } from "../domain/normalize-event";

// 단일 캘린더 (하위호환) 또는 다중 캘린더 (calendars[]) 중 하나만 허용.
// 둘 다 들어오면 zod refine으로 throw — silent merge 금지.
const InputSchema = z
  .object({
    withinHours: z.number().int().min(1).max(336).default(24),
    limit: z.number().int().min(1).max(50).default(10),
    calendarId: z.string().optional(),
    calendars: z
      .array(z.object({ id: z.string(), summary: z.string() }))
      .min(1)
      .optional(),
  })
  .refine((v) => !(v.calendarId && v.calendars), {
    message: "calendarId와 calendars는 동시 지정 불가 — 하나만 사용하세요.",
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
      "다음 N시간(기본 24h, 최대 336h=2주)의 Google Calendar 일정을 시작 시각 오름차순으로 반환합니다. 반복 일정은 인스턴스로 펼쳐집니다. calendars[]를 주면 여러 캘린더를 병렬 조회 후 머지합니다.",
    input: InputSchema,
    output: OutputSchema,
    handler: async (input) => {
      const withinHours: number = input.withinHours ?? 24;
      const limit: number = input.limit ?? 10;
      // 입력 정규화 — 항상 calendars[] 형태로 통일.
      const calendars: Array<{ id: string; summary: string }> = input.calendars
        ? input.calendars
        : [{ id: input.calendarId ?? "primary", summary: input.calendarId ?? "primary" }];

      const accessToken = await deps.getAccessToken();
      const nowMs = now().getTime();
      const timeMin = new Date(nowMs).toISOString();
      const timeMax = new Date(nowMs + withinHours * 60 * 60 * 1000).toISOString();

      // 각 per-call에 글로벌 limit과 같은 maxResults를 주어야 merge 후 정확히
      // limit개의 가장 이른 이벤트를 보존할 수 있다. 작게 주면 늦은 이벤트가
      // 들어왔어야 할 자리에 빠르게 끝난 다른 캘린더 이벤트가 들어가는 버그.
      const perCallMax = limit;

      const results = await Promise.all(
        calendars.map(async (cal) => {
          const r = await deps.listFn({
            accessToken,
            calendarId: cal.id,
            timeMin,
            timeMax,
            maxResults: perCallMax,
          });
          return r.items.map((raw) =>
            normalizeEvent(raw, {
              calendarId: cal.id,
              calendarSummary: cal.summary,
            }),
          );
        }),
      );

      const merged = results.flat().sort((a, b) => a.startAt.localeCompare(b.startAt));
      const trimmed = merged.slice(0, limit);

      return {
        events: trimmed,
        fetchedAt: new Date(nowMs).toISOString(),
      };
    },
  });
}

export type GetUpcomingEventsTool = ReturnType<typeof makeGetUpcomingEventsTool>;
