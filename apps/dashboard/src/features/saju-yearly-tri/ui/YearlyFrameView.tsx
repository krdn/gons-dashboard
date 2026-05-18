"use client";

// YearlyFrame 표시 + narrative 영역.
//
// lifetime 의 LifetimeFrameView 와 동일한 props 패턴 (narrative/loading/error/retryRemainingMs/onFetch)
// 이나, frame shape 가 완전히 달라 별도 컴포넌트.
//
// 헤드라인 (D5 권장안):
//   - netVerdict 색 발레키 (favorable=그린, unfavorable=레드, mixed=회색)
//   - currentDaeun (대운 구간)
//   - yearGanji (세운 간지)
//
// 그 외 정보 (보조):
//   - yongShinDelta (강해진/약해진 오행)
//   - daeunTransition (대운 전환 예고, 있을 때만)
//   - ganjiInteractions (충/합/형/파/해, 있을 때만)
//   - shensha (신살, 있을 때만)
//   - schoolSpecificHints (학파 고유 힌트)
//
// state lift-up (Polish G): narrative 캐시/AbortController/카운트다운 모두 부모(TriYearlyTabs) 보유.

import type { YearlyFrame, Yongshin } from "@gons/saju";

interface Props {
  frame: YearlyFrame;
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

function verdictStyle(verdict: YearlyFrame["yongShinDelta"]["netVerdict"]): {
  label: string;
  className: string;
} {
  switch (verdict) {
    case "favorable":
      return { label: "길운 (favorable)", className: "text-green-700 font-bold" };
    case "unfavorable":
      return { label: "흉운 (unfavorable)", className: "text-red-700 font-bold" };
    case "mixed":
      return { label: "혼합 (mixed)", className: "text-[var(--color-text-muted)] font-bold" };
  }
}

function formatGanji(gz: { stem: string; branch: string }): string {
  return `${gz.stem}${gz.branch}`;
}

// Yongshin 은 학파별 discriminated union — 핵심 식별값을 한 줄로 압축.
function formatYongshin(ys: Yongshin): string {
  switch (ys.school) {
    case "ko":
      return `${ys.primary}${ys.secondary ? ` / ${ys.secondary}` : ""}`;
    case "cn-ziping":
      return `${ys.primary}${ys.structureHint ? ` (${ys.structureHint})` : ""}`;
    case "cn-mangpai":
      return ys.primary;
    case "jp":
      return ys.favorable.length > 0 ? `+${ys.favorable.join(", ")}` : "-";
  }
}

export function YearlyFrameView({
  frame,
  narrative,
  loading,
  error,
  retryRemainingMs,
  onFetch,
}: Props) {
  const rateLimited = retryRemainingMs > 0;
  const verdict = verdictStyle(frame.yongShinDelta.netVerdict);

  return (
    <div className="border rounded p-4 space-y-3">
      {/* 헤드라인: netVerdict + yearGanji + currentDaeun */}
      <div className="space-y-1">
        <div className={`text-lg ${verdict.className}`}>{verdict.label}</div>
        <div className="text-sm text-gray-700">
          {frame.targetYear}년 세운: <span className="font-medium">{formatGanji(frame.yearGanji)}</span>
        </div>
        <div className="text-sm text-gray-700">
          대운 ({frame.currentDaeun.startAge}–{frame.currentDaeun.endAge}세):{" "}
          <span className="font-medium">{formatGanji(frame.currentDaeun.ganji)}</span>
          {frame.daeunTransition && (
            <span className="text-[var(--color-text-muted)]">
              {" "}
              · {frame.daeunTransition.willTransitionAt}세에 {formatGanji(frame.daeunTransition.nextGanji)} 로 전환
            </span>
          )}
        </div>
      </div>

      {/* 용신 변동 */}
      <div className="text-sm space-y-0.5">
        {frame.yongShinDelta.reinforced.length > 0 && (
          <div>
            강해짐: <span className="text-green-700">{frame.yongShinDelta.reinforced.join(" · ")}</span>
          </div>
        )}
        {frame.yongShinDelta.weakened.length > 0 && (
          <div>
            약해짐: <span className="text-red-700">{frame.yongShinDelta.weakened.join(" · ")}</span>
          </div>
        )}
        <div className="text-[var(--color-text-muted)]">
          용신 기준: {formatYongshin(frame.yongShinUsed)}
        </div>
      </div>

      {/* 간지 상호작용 (충/합/형/파/해) */}
      {frame.ganjiInteractions.length > 0 && (
        <div className="text-sm space-y-0.5">
          <div className="text-[var(--color-text-muted)]">간지 상호작용:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {frame.ganjiInteractions.map((gi, idx) => (
              <li key={idx}>
                {gi.subject.pillar}주 {gi.subject.element} {gi.type} {gi.object}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 신살 (shensha) */}
      {frame.shensha.length > 0 && (
        <div className="text-sm space-y-0.5">
          <div className="text-[var(--color-text-muted)]">신살:</div>
          <div>{frame.shensha.map((s) => `${s.name}(${s.pillar})`).join(" · ")}</div>
        </div>
      )}

      {/* 학파 고유 힌트 */}
      {Object.keys(frame.schoolSpecificHints).length > 0 && (
        <div className="text-sm space-y-0.5">
          {Object.entries(frame.schoolSpecificHints).map(([key, value]) => (
            <div key={key}>
              <span className="text-[var(--color-text-muted)]">{key}:</span> {value}
            </div>
          ))}
        </div>
      )}

      {/* narrative + lazy fetch trigger */}
      {narrative ? (
        <div className="whitespace-pre-wrap text-sm border-t pt-3">{narrative}</div>
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
        <div className="text-red-600 text-sm" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
