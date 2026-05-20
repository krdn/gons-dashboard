// 삼국 관점 년운 위젯 — server component.
//
// /fortune/[profileId] 페이지 안 SajuTriLifetime 다음에 mount.
// getOrBuildYearly 캐시 hit/miss 처리 후 YearlyCrossCheckBadge + TriYearlyTabs 조립.
//
// targetYear: 기본은 KST 현재 연도. RSC props 로 외부 주입 가능 (향후 연도 선택 UI 대비).
//
// 에러 처리: getOrBuildYearly 실패 시 .then(success, failure) discriminated union 으로
// 결과를 좁힌 뒤 JSX 분기. try/catch 안에서 JSX 를 생성하지 않는다 — react-hooks/error-boundaries
// lint 규칙 준수 (memory `react-error-boundaries-lint-rule`).
//
// narrative 는 client (TriYearlyTabs) 가 lazy fetch — RSC 는 frame data 만 prefetch.
import {
  getOrBuildYearly,
  currentKstYear,
} from "@/features/saju-yearly-tri/api/yearly-server";
import { YearlyCrossCheckBadge } from "@/features/saju-yearly-tri/ui/YearlyCrossCheckBadge";
import { TriYearlyTabs } from "@/features/saju-yearly-tri/ui/TriYearlyTabs";
import { toUserMessage } from "@/features/saju-yearly-tri/lib/errorMessage";
import type { SajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";

interface Props {
  profileId: string;
  userId: string;
  targetYear?: number;
  modelKey: SajuModelKey;
}

export async function SajuTriYearly({ profileId, userId, targetYear, modelKey }: Props) {
  const year = targetYear ?? currentKstYear();

  const result = await getOrBuildYearly(profileId, userId, year).then(
    ({ triNation }) => ({ ok: true as const, triNation }),
    (e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : "INTERNAL_ERROR",
    }),
  );

  const headingId = "tri-yearly-heading";

  if (result.ok) {
    return (
      <section
        aria-labelledby={headingId}
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2
          id={headingId}
          className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
        >
          삼국 관점 {year}년 세운
        </h2>
        <div className="space-y-4">
          <YearlyCrossCheckBadge triNation={result.triNation} />
          <TriYearlyTabs
            profileId={profileId}
            targetYear={year}
            triNation={result.triNation}
            modelKey={modelKey}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${headingId}-error`}
      className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
    >
      <h2
        id={`${headingId}-error`}
        className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
      >
        삼국 관점 {year}년 세운
      </h2>
      <p className="text-sm text-red-600">{toUserMessage(result.error)}</p>
    </section>
  );
}
