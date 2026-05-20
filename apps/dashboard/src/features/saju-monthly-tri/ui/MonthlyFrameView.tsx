"use client";

// MonthlyFrame 표시 + narrative 영역.
//
// YearlyFrameView 미러. 차이:
//  - frame.yearGanji → frame.monthGanji
//  - 헤더에 targetMonth 추가 ("YYYY년 M월 월운")
//  - narrative sections shape 는 MonthlyNarrativeSections (yearly 와 동일 7필드)
//
// v0.3.1 narrative richer: narrative 가 단순 문자열에서 구조화 payload 로 변경.
// shared/ui/saju-narrative 의 4 컴포넌트로 lifetime/yearly 와 동일 패턴 렌더.
//
// state lift-up (yearly 와 동일): narrative 캐시/AbortController/카운트다운은 부모(TriMonthlyTabs).

import type { MonthlyFrame, Yongshin } from "@gons/saju";
import type {
  MonthlyNarrativeSections,
  NarrativeSchool,
  SchoolSpecific,
} from "@/shared/lib/db/schema";
import {
  CitationsFootnote,
  KeyTermsStrip,
  ModelBadge,
  NarrativeSection,
  SchoolSpecificCard,
} from "@/shared/ui/saju-narrative";

export interface MonthlyNarrativePayload {
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  // v1 row 호환 (v0.3 시점 에는 schoolSpecific 가 없었음).
  schoolSpecific: SchoolSpecific | null;
  citations: string[];
  modelId: string;
}

interface Props {
  frame: MonthlyFrame;
  school: NarrativeSchool;
  narrative: MonthlyNarrativePayload | null;
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

function verdictStyle(verdict: MonthlyFrame["yongShinDelta"]["netVerdict"]): {
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

export function MonthlyFrameView({
  frame,
  school,
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
      {/* 헤드라인: netVerdict + monthGanji + currentDaeun */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className={`text-lg ${verdict.className}`}>{verdict.label}</div>
          {narrative && <ModelBadge modelId={narrative.modelId} />}
        </div>
        <div className="text-sm text-gray-700">
          {frame.targetYear}년 {frame.targetMonth}월 월운:{" "}
          <span className="font-medium">{formatGanji(frame.monthGanji)}</span>
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

      {/* 신살 */}
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

      {/* narrative + lazy fetch trigger — v0.3.1: shared/ui/saju-narrative 4 컴포넌트 조립 */}
      {narrative ? (
        <div className="border-t pt-3 space-y-3">
          <KeyTermsStrip keyTerms={narrative.sections.keyTerms} />
          <NarrativeSection title="성격·기질" body={narrative.sections.personality} />
          <NarrativeSection title="직업·재물" body={narrative.sections.career} />
          <NarrativeSection title="관계" body={narrative.sections.relationship} />
          <NarrativeSection title="건강" body={narrative.sections.health} />
          <NarrativeSection title="대운 흐름" body={narrative.sections.daeunSummary} />
          {narrative.schoolSpecific && (
            <SchoolSpecificCard
              school={school}
              schoolSpecific={narrative.schoolSpecific}
            />
          )}
          <CitationsFootnote citations={narrative.citations} />
        </div>
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
