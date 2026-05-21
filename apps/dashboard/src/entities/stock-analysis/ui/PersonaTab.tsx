"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  PersonaAnalysis,
  PersonaKey,
} from "../client";
import { PERSONA_DISPLAY } from "../client";
import { ConsensusBadge } from "./ConsensusBadge";

interface Props {
  persona: PersonaKey;
  analysis: PersonaAnalysis | null;
  symbol?: string;
  onRegenerate?: () => Promise<{ success: boolean; error?: string }>;
}

const MODEL_LABEL: Record<"claude" | "codex" | "gemini", string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

export function PersonaTab({ persona, analysis, symbol, onRegenerate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = () => {
    if (!onRegenerate) return;
    setError(null);
    startTransition(async () => {
      const res = await onRegenerate();
      if (!res.success) {
        setError(res.error ?? "재생성 실패");
        return;
      }
      setTimeout(() => router.refresh(), 1000);
    });
  };

  if (!analysis) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
        <div className="flex items-center justify-between gap-2">
          <span>
            {PERSONA_DISPLAY[persona]} 분석이 실패했습니다. 다른 페르소나의 결과를 참조하세요.
          </span>
          {onRegenerate && symbol && (
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={pending}
              className="shrink-0 rounded border border-[var(--color-hairline)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {pending ? "재생성 중…" : "재생성"}
            </button>
          )}
        </div>
        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ConsensusBadge verdict={analysis.verdict} size="sm" />
          <span className="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
            {MODEL_LABEL[analysis.modelUsed]}
          </span>
        </div>
        {onRegenerate && symbol && (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={pending}
            className="rounded border border-[var(--color-hairline)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            {pending ? "재생성 중…" : "재생성"}
          </button>
        )}
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
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
