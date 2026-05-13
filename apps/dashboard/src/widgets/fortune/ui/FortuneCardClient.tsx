"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  RELATION_LABEL,
  type FortuneProfile,
} from "@/entities/fortune-profile/model/types";
import {
  FORTUNE_DATA_BY_BIRTH,
  type FortuneData,
  type FortuneScore,
} from "./fortune-data";

const SCORE_DOTS = [1, 2, 3, 4, 5] as const;

function ScoreDots({ score }: { score: number }) {
  return (
    <span
      className="inline-flex gap-0.5"
      aria-label={`${score} / 5`}
      role="img"
    >
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

function ScoreRow({ score }: { score: FortuneScore }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{score.label}</span>
          <ScoreDots score={score.score} />
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          {score.note}
        </p>
      </div>
    </li>
  );
}

function pickDefaultProfileId(profiles: FortuneProfile[]): string | null {
  if (profiles.length === 0) return null;
  const self = profiles.find((p) => p.relation === "self");
  return (self ?? profiles[0]).id;
}

export function FortuneCardClient({
  profiles,
}: {
  profiles: FortuneProfile[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    pickDefaultProfileId(profiles),
  );

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  const fortune: FortuneData | null = selected
    ? (FORTUNE_DATA_BY_BIRTH[selected.birthDate] ?? null)
    : null;

  if (profiles.length === 0) {
    return (
      <section
        aria-labelledby="fortune-heading"
        className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
      >
        <h2
          id="fortune-heading"
          className="mb-3 text-base font-semibold text-[var(--color-text-muted)]"
        >
          오늘의 운세
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          사주 프로필을 추가하면 운세를 볼 수 있어요.
        </p>
        <Link
          href="/fortune"
          className="mt-3 inline-block text-xs text-[var(--color-accent)] hover:underline"
        >
          프로필 추가하러 가기 →
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="fortune-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          id="fortune-heading"
          className="text-base font-semibold text-[var(--color-text-muted)]"
        >
          오늘의 운세
        </h2>
        <Link
          href="/fortune"
          className="text-xs text-[var(--color-text-subtle)] hover:underline"
          aria-label="사주 프로필 관리"
        >
          관리
        </Link>
      </div>

      <label className="mb-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span className="shrink-0">대상</span>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 rounded border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({RELATION_LABEL[p.relation]})
            </option>
          ))}
        </select>
      </label>

      {!fortune ? (
        <NoDataState profile={selected} />
      ) : (
        <FortuneBody fortune={fortune} />
      )}
    </section>
  );
}

function NoDataState({ profile }: { profile: FortuneProfile | null }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-hairline-strong)] px-4 py-5">
      <p className="text-sm text-[var(--color-text-muted)]">
        {profile
          ? `${profile.name} 님의 오늘 운세 데이터가 아직 없어요.`
          : "선택된 프로필이 없어요."}
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
        현재 PlayMCP 운세 서버 버그로 자동 생성이 막혀있어요. 다른 프로필을
        선택해 보세요.
      </p>
    </div>
  );
}

function FortuneBody({ fortune: f }: { fortune: FortuneData }) {
  const goldenHour = f.hourly.find((h) => h.isGolden);
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs tabular-nums text-[var(--color-text-subtle)]">
          {f.forDate} · 일진 {f.dayPillar}
        </span>
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <ScoreDots score={f.overallScore} />
        <span className="text-xs text-[var(--color-text-subtle)]">
          종합 {f.overallScore} / 5
        </span>
      </div>

      <p className="mb-4 text-sm text-[var(--color-text-muted)]">{f.summary}</p>

      <ul className="mb-4 divide-y divide-[var(--color-hairline)]">
        {f.scores.map((s) => (
          <ScoreRow key={s.label} score={s} />
        ))}
      </ul>

      {goldenHour && (
        <div className="mb-4 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 px-3 py-2">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] align-middle" />
            황금시간 {goldenHour.range}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            {goldenHour.vibe}
          </p>
        </div>
      )}

      <details className="mb-3 group">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          시간대별 흐름 펼치기
        </summary>
        <ul className="mt-2 flex flex-col gap-1.5 pl-1">
          {f.hourly.map((h) => (
            <li
              key={h.range}
              className="flex items-baseline gap-2 text-xs tabular-nums text-[var(--color-text-subtle)]"
            >
              <span
                className={`min-w-[3.5rem] ${
                  h.isGolden ? "text-[var(--color-accent)]" : ""
                }`}
              >
                {h.range}
              </span>
              <span className={h.isGolden ? "text-[var(--color-text)]" : ""}>
                {h.vibe}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="mb-1 font-medium text-[var(--color-text-muted)]">
            추천
          </p>
          <ul className="flex flex-col gap-1 text-[var(--color-text-subtle)]">
            {f.recommendations.map((r) => (
              <li key={r} className="flex gap-1">
                <span aria-hidden>·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 font-medium text-[var(--color-text-muted)]">
            주의
          </p>
          <ul className="flex flex-col gap-1 text-[var(--color-text-subtle)]">
            {f.cautions.map((c) => (
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
          <dd>{f.remedy.colors.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">방향</dt>
          <dd>{f.remedy.directions.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">음식</dt>
          <dd>{f.remedy.foods.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">아이템</dt>
          <dd>{f.remedy.items.join(", ")}</dd>
        </dl>
      </details>

      <blockquote className="mt-4 border-l-2 border-[var(--color-hairline-strong)] pl-3 text-xs italic text-[var(--color-text-subtle)]">
        {f.closing}
      </blockquote>
    </>
  );
}
