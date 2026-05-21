"use client";

import type {
  PersonaAnalysis,
  PersonaKey,
} from "../client";
import { PERSONA_DISPLAY } from "../client";
import { ConsensusBadge } from "./ConsensusBadge";

interface Props {
  persona: PersonaKey;
  analysis: PersonaAnalysis | null;
}

const MODEL_LABEL: Record<"claude" | "codex" | "gemini", string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

export function PersonaTab({ persona, analysis }: Props) {
  if (!analysis) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
        {PERSONA_DISPLAY[persona]} 분석이 실패했습니다. 다른 페르소나의 결과를 참조하세요.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ConsensusBadge verdict={analysis.verdict} size="sm" />
        <span className="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
          {MODEL_LABEL[analysis.modelUsed]}
        </span>
      </div>
      <p className="text-sm font-semibold leading-snug">
        {analysis.oneLineThesis}
      </p>
      <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-text)]">
        {analysis.narrative}
      </p>
      {Object.keys(analysis.keyMetrics).length > 0 && (
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--color-surface-2)] p-3 text-xs md:grid-cols-3">
          {Object.entries(analysis.keyMetrics).map(([key, value]) => (
            <div key={key}>
              <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                {key}
              </dt>
              <dd className="font-semibold tabular-nums">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {analysis.risks.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            주요 리스크
          </div>
          <ul className="list-inside list-disc text-xs text-[var(--color-text)]">
            {analysis.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
