// 삼국 관점 일운 위젯 — server component.
//
// /fortune/[profileId] 페이지 daily 탭에 mount.
// getOrBuildDaily 캐시 hit/miss 처리 후 DailyCrossCheckBadge + TriDailyTabs 조립.
//
// forDate: 기본은 KST 현재 날짜. RSC props 로 외부 주입 가능 (향후 날짜 선택 UI 대비).
//
// 에러 처리: getOrBuildDaily 실패 시 .then(success, failure) discriminated union 으로
// 결과를 좁힌 뒤 JSX 분기. try/catch 안에서 JSX 를 생성하지 않는다 —
// react-hooks/error-boundaries lint 규칙 준수.
//
// narrative 는 client (TriDailyTabs) 가 lazy fetch — RSC 는 frame data 만 prefetch.
import {
  getOrBuildDaily,
  DailyCrossCheckBadge,
  TriDailyTabs,
} from "@/features/saju-daily-tri";
import { toUserMessage } from "@/features/saju-daily-tri/lib/errorMessage";
import { currentKstDate } from "@/shared/lib/saju/resolveBirthInput";
import type { SajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";

interface Props {
  profileId: string;
  userId: string;
  forDate?: string;
  modelKey: SajuModelKey;
}

export async function SajuTriDaily({
  profileId,
  userId,
  forDate,
  modelKey,
}: Props) {
  const date = forDate ?? currentKstDate();

  const result = await getOrBuildDaily(profileId, userId, date).then(
    ({ triNation }) => ({ ok: true as const, triNation }),
    (e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : "INTERNAL_ERROR",
    }),
  );

  const headingId = "tri-daily-heading";

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
          삼국 관점 {date} 일운
        </h2>
        <div className="space-y-4">
          <DailyCrossCheckBadge triNation={result.triNation} />
          <TriDailyTabs
            profileId={profileId}
            forDate={date}
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
        삼국 관점 {date} 일운
      </h2>
      <p className="text-sm text-red-600">{toUserMessage(result.error)}</p>
    </section>
  );
}
