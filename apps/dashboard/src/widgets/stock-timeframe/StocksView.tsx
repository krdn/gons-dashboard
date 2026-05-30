"use client";

import { useState } from "react";
import {
  PerspectiveGrid,
  SnapshotCard,
  type AnalysisResult,
  type TimeframeHistoryItem,
} from "@/entities/stock-timeframe/client";
import { TickerInput } from "@/features/stock-timeframe-analyze/ui/TickerInput";
import { analyzeTimeframe } from "@/features/stock-timeframe-analyze/api/analyzeTimeframe";
import { HistoryPanel } from "./HistoryPanel";

export function StocksView({ initialHistory }: { initialHistory: TimeframeHistoryItem[] }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
        <TickerInput onAnalyze={(ticker) => handleAnalyze(ticker)} isLoading={isLoading} />
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
