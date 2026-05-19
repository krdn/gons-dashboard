"use client";

// LifetimeFrame 표시 + narrative 영역 (v0.2 — KeyTermsStrip / NarrativeSection ×5 /
// SchoolSpecificCard / CitationsFootnote 조립).
import type { LifetimeFrame } from "@gons/saju";
import type {
  LifetimeNarrativeSections,
  SchoolSpecific,
} from "@/shared/lib/db/schema";
import type { NarrativeSchool } from "../api/prompts";
import { KeyTermsStrip } from "./KeyTermsStrip";
import { NarrativeSection } from "./NarrativeSection";
import { CitationsFootnote } from "./CitationsFootnote";
import { SchoolSpecificCard } from "./school-specific/SchoolSpecificCard";

interface NarrativePayload {
  narrativeText: string;
  sections: LifetimeNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
}

interface Props {
  frame: LifetimeFrame;
  school: NarrativeSchool;
  narrative: NarrativePayload | null;
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

const SECTION_LABELS = {
  personality: "성격·기질",
  career: "직업·진로",
  relationship: "인간관계",
  health: "건강 관리",
  daeunSummary: "대운 흐름",
} as const;

export function LifetimeFrameView({
  frame,
  school,
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
      <div className="text-sm text-gray-700">
        {frame.formatGyeokguk.reasoning}
      </div>
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
        <div className="space-y-3">
          <KeyTermsStrip keyTerms={narrative.sections.keyTerms} />
          <NarrativeSection
            title={SECTION_LABELS.personality}
            body={narrative.sections.personality}
          />
          <NarrativeSection
            title={SECTION_LABELS.career}
            body={narrative.sections.career}
          />
          <NarrativeSection
            title={SECTION_LABELS.relationship}
            body={narrative.sections.relationship}
          />
          <NarrativeSection
            title={SECTION_LABELS.health}
            body={narrative.sections.health}
          />
          <NarrativeSection
            title={SECTION_LABELS.daeunSummary}
            body={narrative.sections.daeunSummary}
          />
          <SchoolSpecificCard
            school={school}
            schoolSpecific={narrative.schoolSpecific}
          />
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
          분당 요청 한도 초과 — {formatRetryRemaining(retryRemainingMs)} 후 다시
          시도해주세요.
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
