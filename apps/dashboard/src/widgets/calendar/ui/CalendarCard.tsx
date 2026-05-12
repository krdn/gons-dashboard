import "server-only";
import Link from "next/link";
import { env } from "@/shared/config/env";
import {
  makeGetUpcomingEventsTool,
  type CalendarEvent,
} from "@gons/mcp-calendar";
import {
  fetchAccessToken,
  listUpcomingEvents,
  OAuthExpiredError,
} from "@gons/shared-google";
import { groupByDay } from "../lib/groupByDay";
import { formatHHMM } from "./format";

// in-process로 mcp-calendar tool을 호출. 토큰은 같은 프로세스의 mediator
// 라우트를 fetch (https://localhost 자체호출은 피하고 절대 URL 사용).
async function fetchEventsForWidget(): Promise<
  { ok: true; events: CalendarEvent[] } | { ok: false; reason: "reauth" | "transient" }
> {
  const mediatorUrl = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/mcp/credentials/google`;
  const tool = makeGetUpcomingEventsTool({
    getAccessToken: async () => {
      const r = await fetchAccessToken({
        mediatorUrl,
        bearer: env.MCP_DASHBOARD_TOKEN,
      });
      return r.accessToken;
    },
    listFn: listUpcomingEvents,
  });
  try {
    const result = await tool.handler({
      withinHours: 48, // today + tomorrow 범위를 안전하게 커버
      limit: 20,
      calendarId: "primary",
    });
    return { ok: true, events: result.events };
  } catch (err) {
    if (err instanceof OAuthExpiredError) return { ok: false, reason: "reauth" };
    return { ok: false, reason: "transient" };
  }
}

export async function CalendarCard() {
  const result = await fetchEventsForWidget();

  if (!result.ok && result.reason === "reauth") {
    return <ReauthState />;
  }
  if (!result.ok && result.reason === "transient") {
    return <TransientState />;
  }

  const groups = groupByDay(result.ok ? result.events : [], new Date());
  const hasAny = groups.today.length + groups.tomorrow.length > 0;

  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="calendar-heading"
        className="mb-4 text-base font-semibold text-[var(--color-text-muted)]"
      >
        Calendar
      </h2>
      {hasAny ? (
        <div className="flex flex-col gap-5">
          {groups.today.length > 0 && (
            <DayGroup label="오늘" events={groups.today} now={new Date()} />
          )}
          {groups.tomorrow.length > 0 && (
            <DayGroup label="내일" events={groups.tomorrow} now={null} />
          )}
        </div>
      ) : (
        <EmptyState />
      )}
      <p className="mt-5 text-xs">
        <a
          href="https://calendar.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-text-muted)] hover:underline"
        >
          Google 캘린더에서 열기 →
        </a>
      </p>
    </section>
  );
}

function DayGroup({
  label,
  events,
  now,
}: {
  label: string;
  events: CalendarEvent[];
  now: Date | null;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">
        {label}
      </h3>
      <ul className="flex flex-col gap-3">
        {events.map((ev) => (
          <EventRow key={ev.id} event={ev} now={now} />
        ))}
      </ul>
    </div>
  );
}

function EventRow({ event, now }: { event: CalendarEvent; now: Date | null }) {
  const start = formatHHMM(event.startAt);
  const end = formatHHMM(event.endAt);
  const inProgress =
    now !== null &&
    new Date(event.startAt).getTime() <= now.getTime() &&
    now.getTime() <= new Date(event.endAt).getTime();
  return (
    <li>
      <a
        href={event.htmlLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg border border-transparent px-2 py-1 hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
      >
        <div className="flex items-baseline gap-2 text-xs tabular-nums text-[var(--color-text-muted)]">
          <time dateTime={event.startAt}>{start}</time>
          <span aria-hidden>—</span>
          <time dateTime={event.endAt}>{end}</time>
          {inProgress && (
            <span
              aria-label="진행 중"
              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
            />
          )}
        </div>
        <div className="text-sm font-medium">{event.title}</div>
        {(event.meetingUrl || event.attendees.length > 0) && (
          <div className="text-xs text-[var(--color-text-subtle)]">
            {event.meetingUrl && <>Google Meet</>}
            {event.meetingUrl && event.attendees.length > 0 && <> · </>}
            {event.attendees.length > 0 && <>{event.attendees.length}명</>}
          </div>
        )}
      </a>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--color-text-muted)]">
        다음 24시간 동안 일정이 없습니다.
      </p>
      <blockquote className="text-xs italic text-[var(--color-text-subtle)]">
        ⌬ &quot;쉼 없는 일상은 일상이 아니라 중단이다.&quot; — 한병철
      </blockquote>
    </div>
  );
}

function ReauthState() {
  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="calendar-heading"
        className="mb-2 text-base font-semibold text-[var(--color-text-muted)]"
      >
        Calendar
      </h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        Google 캘린더 접근 권한이 만료되었어요.
      </p>
      <Link
        href="/login"
        className="mt-3 inline-block text-xs text-[var(--color-accent)] hover:underline"
      >
        다시 로그인 →
      </Link>
    </section>
  );
}

function TransientState() {
  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="calendar-heading"
        className="mb-2 text-base font-semibold text-[var(--color-text-muted)]"
      >
        Calendar
      </h2>
      <p className="text-sm text-[var(--color-text-subtle)]">
        잠시 캘린더를 불러오지 못했어요. 잠시 후 다시 시도됩니다.
      </p>
    </section>
  );
}
