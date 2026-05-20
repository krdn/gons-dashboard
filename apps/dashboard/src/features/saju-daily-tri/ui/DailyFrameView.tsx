"use client";

// DailyLiteFrame 표시 + narrative 영역.
//
// monthly 의 MonthlyFrameView 와 달리 daily frame 은 의도적 단순화 모델
// (dayGanji + dayVibe + hints) — 충/합 분석·신살·schoolSpecificHints 없음.
// narrative 부분만 monthly 와 동일하게 shared/ui/saju-narrative 4 컴포넌트 조합.
//
// state lift-up (monthly 와 동일): narrative 캐시/AbortController/카운트다운은 부모(TriDailyTabs).

import type { DailyLiteFrame } from "@gons/saju";
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

export interface DailyNarrativePayload {
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  schoolSpecific: SchoolSpecific | null;
  citations: string[];
  modelId: string;
}

interface Props {
  frame: DailyLiteFrame;
  school: NarrativeSchool;
  narrative: DailyNarrativePayload | null;
  loading: boolean;
  error: string | null;
  retryRemainingMs: number;
  onFetch: () => void;
}

function formatRetryRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function vibeStyle(vibe: DailyLiteFrame["dayVibe"]): {
  label: string;
  className: string;
} {
  switch (vibe) {
    case "auspicious":
      return { label: "길운 (auspicious)", className: "text-green-700 font-bold" };
    case "inauspicious":
      return { label: "흉운 (inauspicious)", className: "text-red-700 font-bold" };
    case "neutral":
      return { label: "중립 (neutral)", className: "text-[var(--color-text-muted)] font-bold" };
  }
}

export function DailyFrameView({
  frame,
  school,
  narrative,
  loading,
  error,
  retryRemainingMs,
  onFetch,
}: Props) {
  const rateLimited = retryRemainingMs > 0;
  const vibe = vibeStyle(frame.dayVibe);

  return (
    <div className="border rounded p-4 space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className={`text-lg ${vibe.className}`}>{vibe.label}</div>
          {narrative && <ModelBadge modelId={narrative.modelId} />}
        </div>
        <div className="text-sm text-gray-700">
          {frame.forDate} 일진:{" "}
          <span className="font-medium">
            {frame.dayGanji.stem}{frame.dayGanji.branch}
          </span>
        </div>
      </div>

      {frame.hints.length > 0 && (
        <div className="text-sm space-y-0.5">
          <div className="text-[var(--color-text-muted)]">해석 힌트:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {frame.hints.map((h, idx) => (
              <li key={idx}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {narrative ? (
        <div className="border-t pt-3 space-y-3">
          <KeyTermsStrip keyTerms={narrative.sections.keyTerms} />
          <NarrativeSection title="성격·기질" body={narrative.sections.personality} />
          <NarrativeSection title="직업·재물" body={narrative.sections.career} />
          <NarrativeSection title="관계" body={narrative.sections.relationship} />
          <NarrativeSection title="건강" body={narrative.sections.health} />
          <NarrativeSection title="오늘 흐름 요약" body={narrative.sections.daeunSummary} />
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
