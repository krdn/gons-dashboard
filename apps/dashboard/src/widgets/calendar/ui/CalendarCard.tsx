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
import { formatDayLabel, formatHHMM } from "./format";

const WITHIN_HOURS_2W = 336; // 14일
const FETCH_LIMIT = 50; // mcp-calendar 스키마 상한
const PREVIEW_COUNT = 7; // 위젯에 펼쳐 보일 가까운 일정 개수

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
      withinHours: WITHIN_HOURS_2W,
      limit: FETCH_LIMIT,
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

  const now = new Date();
  const events = result.ok ? result.events : [];
  const preview = events.slice(0, PREVIEW_COUNT);
  const remaining = Math.max(0, events.length - preview.length);

  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="calendar-heading"
        className={`text-base font-semibold text-[var(--color-text-muted)] ${
          events.length > 0 ? "mb-1" : "mb-4"
        }`}
      >
        Calendar
      </h2>
      {events.length > 0 ? (
        <>
          <p className="mb-4 text-xs text-[var(--color-text-subtle)]">
            다음 2주: 일정 {events.length}건
          </p>
          <ul className="flex flex-col gap-2">
            {preview.map((ev) => (
              <EventRow key={ev.id} event={ev} now={now} />
            ))}
          </ul>
        </>
      ) : (
        <EmptyState />
      )}
      <div className="mt-5 flex items-center justify-between text-xs">
        {remaining > 0 ? (
          <span className="text-[var(--color-text-subtle)]">
            + {remaining}건 더
          </span>
        ) : (
          <span />
        )}
        <a
          href="https://calendar.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-text-muted)] hover:underline"
        >
          Google 캘린더에서 열기 →
        </a>
      </div>
    </section>
  );
}

function EventRow({ event, now }: { event: CalendarEvent; now: Date }) {
  const dayLabel = formatDayLabel(event.startAt, now);
  const startMs = new Date(event.startAt).getTime();
  const endMs = new Date(event.endAt).getTime();
  const inProgress =
    !event.allDay && startMs <= now.getTime() && now.getTime() <= endMs;
  return (
    <li>
      <a
        href={event.htmlLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg border border-transparent px-2 py-1.5 hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
      >
        <div className="flex items-baseline gap-2 text-xs tabular-nums text-[var(--color-text-muted)]">
          <span className="min-w-[3.5rem] text-[var(--color-text-subtle)]">
            {dayLabel}
          </span>
          {event.allDay ? (
            <span className="text-[var(--color-text-subtle)]">종일</span>
          ) : (
            <>
              <time dateTime={event.startAt}>{formatHHMM(event.startAt)}</time>
              <span aria-hidden>—</span>
              <time dateTime={event.endAt}>{formatHHMM(event.endAt)}</time>
            </>
          )}
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
        다음 2주 동안 일정이 없습니다.
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
