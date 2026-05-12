import { z } from "zod";

// CalendarEvent — mcp-calendar 도메인의 표준 이벤트 모양.
// 위젯, Claude, 향후 다른 클라이언트가 모두 이 모양을 받는다.
//
// 정책:
// - 시각은 항상 ISO 8601 UTC. 로컬 변환은 소비자(위젯) 책임 (spec Gotcha #3).
// - 반복 일정은 shared-google이 singleEvents=true로 펼친 인스턴스가 들어옴.
// - meetingUrl은 hangoutLink 우선, 없으면 description에서 Zoom/Meet URL 추출.
export const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  attendees: z.array(
    z.object({
      email: z.string(),
      responseStatus: z
        .enum(["accepted", "declined", "tentative", "needsAction"])
        .nullable(),
    }),
  ),
  meetingUrl: z.string().url().nullable(),
  htmlLink: z.string().url(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
