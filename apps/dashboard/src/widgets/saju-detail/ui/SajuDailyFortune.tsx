import type { DailyFortunePayload } from "@gons/saju";

const SCORE_DOTS = [1, 2, 3, 4, 5] as const;

function ScoreDots({ score }: { score: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${score} / 5`} role="img">
      {SCORE_DOTS.map((i) => (
        <span
          key={i}
          aria-hidden
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            i <= score
              ? "bg-[var(--color-accent)]"
              : "bg-[var(--color-hairline-strong)]"
          }`}
        />
      ))}
    </span>
  );
}

export interface SajuDailyFortuneProps {
  payload: DailyFortunePayload;
  dayPillar: string;
}

export function SajuDailyFortune({ payload, dayPillar }: SajuDailyFortuneProps) {
  const goldenHour = payload.hourly.find((h) => h.isGolden);
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs tabular-nums text-[var(--color-text-subtle)]">
          {payload.forDate} · 일진{" "}
          <span style={{ fontFamily: "var(--font-hanja)" }} lang="ko-Hani">
            {dayPillar}
          </span>
        </span>
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <ScoreDots score={payload.overallScore} />
        <span className="text-xs text-[var(--color-text-subtle)]">
          종합 {payload.overallScore} / 5
        </span>
      </div>

      <p className="mb-4 text-sm text-[var(--color-text-muted)]">{payload.summary}</p>

      <ul className="mb-4 divide-y divide-[var(--color-hairline)]">
        {payload.scores.map((s) => (
          <li key={s.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{s.label}</span>
                <ScoreDots score={s.score} />
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{s.note}</p>
            </div>
          </li>
        ))}
      </ul>

      {goldenHour && (
        <div
          className="mb-4 rounded-lg px-3 py-2"
          style={{
            borderColor: "var(--color-accent)",
            borderWidth: "1px",
            backgroundColor: "color-mix(in oklch, var(--color-accent) 5%, transparent)",
          }}
        >
          <p className="text-xs font-medium text-[var(--color-text-muted)]">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] align-middle" />
            황금시간 {goldenHour.range}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{goldenHour.vibe}</p>
        </div>
      )}

      <details className="mb-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          시간대별 흐름 펼치기
        </summary>
        <ul className="mt-2 flex flex-col gap-1.5 pl-1">
          {payload.hourly.map((h) => (
            <li
              key={h.range}
              className="flex items-baseline gap-2 text-xs tabular-nums text-[var(--color-text-subtle)]"
            >
              <span className={`min-w-[3.5rem] ${h.isGolden ? "text-[var(--color-accent)]" : ""}`}>
                {h.range}
              </span>
              <span className={h.isGolden ? "text-[var(--color-text)]" : ""}>{h.vibe}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="mb-1 font-medium text-[var(--color-text-muted)]">추천</p>
          <ul className="flex flex-col gap-1 text-[var(--color-text-subtle)]">
            {payload.recommendations.map((r) => (
              <li key={r} className="flex gap-1">
                <span aria-hidden>·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 font-medium text-[var(--color-text-muted)]">주의</p>
          <ul className="flex flex-col gap-1 text-[var(--color-text-subtle)]">
            {payload.cautions.map((c) => (
              <li key={c} className="flex gap-1">
                <span aria-hidden>·</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          오늘의 처방
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-subtle)]">
          <dt className="text-[var(--color-text-muted)]">색</dt>
          <dd>{payload.remedy.colors.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">방향</dt>
          <dd>{payload.remedy.directions.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">음식</dt>
          <dd>{payload.remedy.foods.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">아이템</dt>
          <dd>{payload.remedy.items.join(", ")}</dd>
        </dl>
      </details>

      <blockquote className="mt-4 border-l-2 border-[var(--color-hairline-strong)] pl-3 text-xs italic text-[var(--color-text-subtle)]">
        {payload.closing}
      </blockquote>
    </>
  );
}
