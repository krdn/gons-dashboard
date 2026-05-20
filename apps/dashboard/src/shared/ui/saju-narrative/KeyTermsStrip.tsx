"use client";

// 본문 인라인 풀이의 보조 — 핵심 용어 칩 + hover tooltip.
import { useState } from "react";
import type { NarrativeKeyTerm } from "@/shared/lib/db/schema";

interface Props {
  keyTerms: NarrativeKeyTerm[];
}

export function KeyTermsStrip({ keyTerms }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (keyTerms.length === 0) return null;

  return (
    <div className="border-b border-[var(--color-hairline)] py-3">
      <div className="mb-2 text-xs text-[var(--color-text-secondary)]">
        핵심 용어
      </div>
      <ul role="list" className="flex flex-wrap gap-2">
        {keyTerms.map((kt, idx) => (
          <li key={`${kt.term}-${idx}`} role="listitem" className="relative">
            <button
              type="button"
              className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-sm hover:bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onFocus={() => setHoveredIdx(idx)}
              onBlur={() => setHoveredIdx(null)}
              aria-describedby={`keyterm-tooltip-${idx}`}
            >
              {kt.term}
            </button>
            {hoveredIdx === idx && (
              <div
                id={`keyterm-tooltip-${idx}`}
                role="tooltip"
                className="absolute left-0 top-full z-10 mt-1 max-w-xs rounded border border-[var(--color-hairline)] bg-white p-2 text-xs shadow-lg"
              >
                {kt.gloss}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
