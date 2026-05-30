"use client";

import { useState } from "react";
import {
  PerspectiveGrid,
  SnapshotCard,
  type AnalysisResult,
  type TimeframeHistoryItem,
} from "@/entities/stock-timeframe/client";
import type { SearchResult } from "@/entities/stock/client";
import { TickerSearchInput } from "@/features/stock-portfolio-crud/ui/TickerSearchInput";
import { analyzeTimeframe } from "@/features/stock-timeframe-analyze/api/analyzeTimeframe";
import { HistoryPanel } from "./HistoryPanel";

export function StocksView({ initialHistory }: { initialHistory: TimeframeHistoryItem[] }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 검색 드롭다운에서 고른 종목. 분석은 이 종목의 symbol(예: "005930.KS")로 호출.
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(ticker: string) {
    setIsLoading(true);
    setError(null);
    const res = await analyzeTimeframe({ ticker, depth: "lite" });
    setIsLoading(false);
    if (!res.success || !res.result) {
      setError(res.error ?? "분석 실패");
      return;
    }
    setResult(res.result);
    setSelectedId(res.id ?? null);
    setHistory((prev) => [
      {
        id: res.id!,
        ticker: ticker.toUpperCase(),
        depth: "lite",
        asOf: new Date(res.result!.asOf),
        createdAt: new Date(),
      },
      ...prev,
    ]);
  }

  async function handleSelect(id: string) {
    setSelectedId(id);
    setError(null);
    const r = await fetch(`/api/stock/timeframe/${id}`);
    if (!r.ok) {
      setError("이력을 불러오지 못했습니다");
      return;
    }
    const data = (await r.json()) as { result: AnalysisResult };
    setResult(data.result);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <div className="space-y-4">
        <div className="space-y-2">
          <TickerSearchInput
            onSelect={(r) => setSelected(r)}
            placeholder="종목명 또는 티커 검색 (예: 삼성전자, AAPL)"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => selected && handleAnalyze(selected.symbol)}
              disabled={isLoading || !selected}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? "분석 중…" : "분석"}
            </button>
            {selected && (
              <span className="text-xs text-slate-500">
                {selected.displayName} · {selected.symbol}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            빠른 분석 (페르소나당 1회, 총 4회 LLM 호출)
          </p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && (
          <>
            <SnapshotCard snapshot={result.snapshot} />
            <PerspectiveGrid result={result} />
          </>
        )}
      </div>
      <aside className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">이력</h2>
        <HistoryPanel items={history} onSelect={handleSelect} selectedId={selectedId} />
      </aside>
    </div>
  );
}
