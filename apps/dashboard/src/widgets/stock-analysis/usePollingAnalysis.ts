"use client";

// usePollingAnalysis — /api/stock/analyze/status 를 5초 간격으로 폴링.
// - enabled=false 면 NO-OP (mount 시 효과 없음).
// - completed/failed 또는 timeout 도달 시 자동 정지.
// - AbortController 로 in-flight fetch 취소.
// - onComplete 콜백으로 router.refresh 등 부수효과를 부모에 위임 (React 19
//   set-state-in-effect 룰 회피 — useEffect body 동기 setState 없음).

import { useEffect, useState } from "react";
import type { AnalysisRun } from "@/entities/stock-analysis/client";

interface UsePollingArgs {
  symbol: string;
  persona?: "wallStreet" | "krExpert" | "value" | "growth" | "technical";
  enabled: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  onComplete?: () => void;
}

export interface PollingState {
  run: AnalysisRun | null;
  loading: boolean;
  error: string | null;
  timedOut: boolean;
}

export function usePollingAnalysis({
  symbol,
  persona,
  enabled,
  intervalMs = 5_000,
  timeoutMs = 90_000,
  onComplete,
}: UsePollingArgs): PollingState {
  const [state, setState] = useState<PollingState>({
    run: null,
    loading: enabled,
    error: null,
    timedOut: false,
  });

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    const startedAt = Date.now();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const params = new URLSearchParams({ symbol });
        if (persona) params.set("persona", persona);
        const res = await fetch(
          `/api/stock/analyze/status?${params.toString()}`,
          {
            signal: controller.signal,
          },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as { run: AnalysisRun | null };
        setState((prev) => ({ ...prev, run: json.run, loading: false }));

        if (json.run?.status === "completed" || json.run?.status === "failed") {
          if (intervalId) clearInterval(intervalId);
          if (json.run.status === "completed") onComplete?.();
        } else if (Date.now() - startedAt > timeoutMs) {
          if (intervalId) clearInterval(intervalId);
          setState((prev) => ({ ...prev, timedOut: true, loading: false }));
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "polling 실패",
          loading: false,
        }));
        if (intervalId) clearInterval(intervalId);
      }
    };

    void poll();
    intervalId = setInterval(() => void poll(), intervalMs);

    return () => {
      controller.abort();
      if (intervalId) clearInterval(intervalId);
    };
  }, [symbol, persona, enabled, intervalMs, timeoutMs, onComplete]);

  return state;
}
