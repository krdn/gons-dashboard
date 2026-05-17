// 삼국 관점 평생 운세 위젯 — server component.
//
// /fortune/[profileId] 페이지 상단(SajuDetailHeader 다음)에 mount.
// getOrBuildLifetime 캐시 hit/miss 처리 후 CrossCheckBadge + TriNationTabs 조립.
//
// 스타일: 기존 page 의 디자인 토큰(--color-surface/--color-hairline) + aria-labelledby + h2 패턴을 따라
// 시각적 일관성 유지 (plan 의 plain Tailwind 에서 의도적 보강 — Task 7.2 deviation).
import { getOrBuildLifetime } from "@/features/saju-lifetime-tri/api/lifetime-server";
import { TriNationTabs } from "@/features/saju-lifetime-tri/ui/TriNationTabs";
import { CrossCheckBadge } from "@/features/saju-lifetime-tri/ui/CrossCheckBadge";

interface Props {
  profileId: string;
  userId: string;
}

export async function SajuTriLifetime({ profileId, userId }: Props) {
  try {
    const { triNation } = await getOrBuildLifetime(profileId, userId);
    return (
      <section
        aria-labelledby="tri-lifetime-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2
          id="tri-lifetime-heading"
          className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
        >
          삼국 관점 평생 운세
        </h2>
        <div className="space-y-4">
          <CrossCheckBadge triNation={triNation} />
          <TriNationTabs profileId={profileId} triNation={triNation} />
        </div>
      </section>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "분석 실패";
    return (
      <section
        aria-labelledby="tri-lifetime-error-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2
          id="tri-lifetime-error-heading"
          className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
        >
          삼국 관점 평생 운세
        </h2>
        <p className="text-sm text-red-600">삼국 관점 분석 실패: {message}</p>
      </section>
    );
  }
}
