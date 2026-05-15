"use client";

import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPYearlyResult } from "@/entities/tiger-reading";

interface Props {
  payload: PlayMCPYearlyResult;
  year: number;
  availableYears: number[];
  selectedYear: number;
  onYearChange: (year: number) => void;
}

export function TigerYearlyCard({
  payload, year, availableYears, selectedYear, onYearChange,
}: Props) {
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐯</span>
          <div>
            <h2 className="text-lg font-semibold">신년 인사이트</h2>
            <p className="text-sm text-gray-600">{year}년 한 해의 흐름</p>
          </div>
        </div>
        <select
          value={selectedYear}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="rounded border px-2 py-1 text-sm"
          aria-label="연도 선택"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </header>
      <TigerNarrative narrative={payload.result.suggested_narrative_ko} />
    </article>
  );
}
