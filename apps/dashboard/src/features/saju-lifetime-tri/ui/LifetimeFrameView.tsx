"use client";

// LifetimeFrame 표시 + narrative 영역 (Polish G).
//
// LifetimeFrameCard 가 자체 state 로 fetch + retry 카운트다운까지 모두 관리하는 반면
// 이 컴포넌트는 순수 presentational. narrative 캐시 / loading / error / 카운트다운 표시값
// 모두 props 로 받는다. 부모 (TriNationTabs) 가 학파별 캐시 + AbortController + 카운트다운
// useEffect 를 lift-up 해서 보유.
//
// 두 가지 사용처:
// - TriNationTabs: 학파별 캐시 공유 + 탭 전환 race condition 방지 (이 컴포넌트 사용)
// - /fortune/[profileId]/lifetime/[school] 라우트: 단독 카드라 캐시 불필요 (LifetimeFrameCard 사용)

import type { LifetimeFrame } from "@gons/saju";

interface Props {
  frame: LifetimeFrame;
  narrative: string | null;
  loading: boolean;
  error: string | null;
  retryRemainingMs: number; // 0 = rate-limit 상태 아님
  onFetch: () => void;
}

function formatRetryRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function LifetimeFrameView({
  frame,
  narrative,
  loading,
  error,
  retryRemainingMs,
  onFetch,
}: Props) {
  const rateLimited = retryRemainingMs > 0;

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="font-bold">격국: {frame.formatGyeokguk.name}</div>
      <div className="text-sm text-gray-700">{frame.formatGyeokguk.reasoning}</div>
      {frame.yongshin && (
        <div className="text-sm">
          용신: {frame.yongshin.element} — {frame.yongshin.reasoning}
        </div>
      )}
      <div className="text-sm space-y-1">
        <div>직업: {frame.careerHints.join(" · ")}</div>
        <div>관계: {frame.relationshipHints.join(" · ")}</div>
        <div>건강: {frame.healthHints.join(" · ")}</div>
        <div>주의: {frame.cautions.join(" · ")}</div>
      </div>
      {narrative ? (
        <div className="whitespace-pre-wrap text-sm">{narrative}</div>
      ) : (
        <button
          type="button"
          onClick={onFetch}
          disabled={loading || rateLimited}
          className="text-blue-600 text-sm disabled:text-gray-400"
        >
          {loading
            ? "분석 중…"
            : rateLimited
              ? `${formatRetryRemaining(retryRemainingMs)} 후 재시도 가능`
              : "더 자세히 보기"}
        </button>
      )}
      {rateLimited && (
        <div className="text-amber-700 text-sm" role="status" aria-live="polite">
          분당 요청 한도 초과 — {formatRetryRemaining(retryRemainingMs)} 후 다시 시도해주세요.
        </div>
      )}
      {error && !rateLimited && (
        <div className="text-red-600 text-sm" role="alert">{error}</div>
      )}
    </div>
  );
}
