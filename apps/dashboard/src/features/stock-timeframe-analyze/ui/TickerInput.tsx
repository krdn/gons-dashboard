"use client";

import { useState } from "react";

interface TickerInputProps {
  onAnalyze: (ticker: string) => void;
  isLoading: boolean;
}

export function TickerInput({ onAnalyze, isLoading }: TickerInputProps) {
  const [ticker, setTicker] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="US 티커 (예: AAPL)"
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          maxLength={10}
        />
        <button
          type="button"
          onClick={() => onAnalyze(ticker.trim())}
          disabled={isLoading || !ticker.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? "분석 중…" : "분석"}
        </button>
      </div>
      <p className="text-xs text-slate-400">빠른 분석 (페르소나당 1회, 총 4회 LLM 호출)</p>
    </div>
  );
}
