// 삼국 관점 평생 운세 위젯 — server component.
//
// /fortune/[profileId] 페이지 상단(SajuDetailHeader 다음)에 mount.
// getOrBuildLifetime 캐시 hit/miss 처리 후 CrossCheckBadge + TriNationTabs 조립.
//
// 스타일: 기존 page 의 디자인 토큰(--color-surface/--color-hairline) + aria-labelledby + h2 패턴을 따라
// 시각적 일관성 유지 (plan 의 plain Tailwind 에서 의도적 보강 — Task 7.2 deviation).
//
// 에러 처리: getOrBuildLifetime 실패 시 .then(success, failure) discriminated union 으로
// 결과를 좁힌 뒤 JSX 분기. try/catch 안에서 JSX 를 생성하지 않는다 — react-hooks/error-boundaries
// lint 규칙 준수 + 같은 파일 트리(fortune/[profileId]/page.tsx)의 yearlyResult 패턴과 일관.
import { getOrBuildLifetime } from "@/features/saju-lifetime-tri/api/lifetime-server";
import { TriNationTabs } from "@/features/saju-lifetime-tri/ui/TriNationTabs";
import { CrossCheckBadge } from "@/features/saju-lifetime-tri/ui/CrossCheckBadge";
import { toUserMessage } from "@/features/saju-lifetime-tri/lib/errorMessage";
import type { SajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";

interface Props {
  profileId: string;
  userId: string;
  modelKey: SajuModelKey;
}

export async function SajuTriLifetime({ profileId, userId, modelKey }: Props) {
  const result = await getOrBuildLifetime(profileId, userId).then(
    ({ triNation }) => ({ ok: true as const, triNation }),
    (e: unknown) => ({
      ok: false as const,
      // stable raw code 유지 — JSX 분기에서 toUserMessage 로 한국어 변환.
      error: e instanceof Error ? e.message : "INTERNAL_ERROR",
    }),
  );

  if (result.ok) {
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
          <CrossCheckBadge triNation={result.triNation} />
          <TriNationTabs profileId={profileId} triNation={result.triNation} modelKey={modelKey} />
        </div>
      </section>
    );
  }

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
      <p className="text-sm text-red-600">{toUserMessage(result.error)}</p>
    </section>
  );
}
