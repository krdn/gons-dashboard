"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  RELATION_LABEL,
  type FortuneProfile,
} from "@/entities/fortune-profile/client";
import type { DailyFortunePayload } from "@krdn/saju";
import { SajuDailyFortune } from "@/widgets/saju-detail/ui/SajuDailyFortune";

interface FortuneByProfile {
  forDate: string;
  dayStem: string;
  dayBranch: string;
  payload: unknown;
}

interface Props {
  profiles: FortuneProfile[];
  fortunesByProfile: Record<string, FortuneByProfile>;
  today: string;
}

function pickDefaultProfileId(profiles: FortuneProfile[]): string | null {
  if (profiles.length === 0) return null;
  const self = profiles.find((p) => p.relation === "self");
  return (self ?? profiles[0]).id;
}

export function FortuneCardClient({
  profiles,
  fortunesByProfile,
  today,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    pickDefaultProfileId(profiles),
  );

  const selectedFortune = useMemo(
    () => (selectedId ? fortunesByProfile[selectedId] : undefined),
    [selectedId, fortunesByProfile],
  );

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
        <div className="flex items-center gap-3 text-xs">
          {selectedId && (
            <Link
              href={`/fortune/${selectedId}`}
              className="text-[var(--color-accent)] hover:underline"
              aria-label="사주 상세보기"
            >
              상세
            </Link>
          )}
          <Link
            href="/fortune"
            className="text-[var(--color-text-subtle)] hover:underline"
            aria-label="사주 프로필 관리"
          >
            관리
          </Link>
        </div>
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

      {!selectedFortune ? (
        <div className="rounded-lg border border-dashed border-[var(--color-hairline-strong)] px-4 py-5">
          <p className="text-sm text-[var(--color-text-muted)]">
            오늘({today}) 일진 풀이를 준비 중입니다.
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            자정 KST cron 이 활성 프로필 × 오늘 일진을 자동 생성합니다.
            상세보기 페이지를 한 번도 열지 않은 프로필은 차트가 없어 일진도 없습니다.
          </p>
        </div>
      ) : (
        <SajuDailyFortune
          payload={selectedFortune.payload as DailyFortunePayload}
          dayPillar={`${selectedFortune.dayStem}${selectedFortune.dayBranch}`}
        />
      )}
    </section>
  );
}
