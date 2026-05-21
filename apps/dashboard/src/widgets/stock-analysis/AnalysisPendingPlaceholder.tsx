"use client";

// AnalysisPendingPlaceholder — 분석 결과가 아직 없는 종목 묶음을 표시.
// - "지금 분석" 버튼 클릭 시 직렬 trigger (for-of + await) — rate-limit 친화.
// - 첫 trigger 된 종목만 폴링 → completed 시 router.refresh → RSC 재요청 →
//   다음 종목으로 자동 진행.
// - router.refresh 는 onComplete 콜백으로 부모(=이 컴포넌트)가 수행 — useEffect
//   안 동기 setState 룰 회피.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import { triggerAnalysis } from "@/features/stock-analysis-server/client";
import { usePollingAnalysis } from "./usePollingAnalysis";

interface Props {
  holdings: PortfolioHolding[];
}

export function AnalysisPendingPlaceholder({ holdings }: Props) {
  const router = useRouter();
  const [triggered, setTriggered] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // 첫 trigger 된 종목만 polling — completed 시 router.refresh → RSC 재요청 → 다음 종목 자동 처리
  const firstTriggered = holdings.find((h) => triggered.has(h.symbol));
  const polling = usePollingAnalysis({
    symbol: firstTriggered?.symbol ?? "",
    enabled: !!firstTriggered,
    onComplete: () => router.refresh(),
  });

  const triggerAll = () => {
    startTransition(async () => {
      for (const h of holdings) {
        if (triggered.has(h.symbol)) continue;
        const res = await triggerAnalysis({ symbol: h.symbol });
        if (!res.success) {
          setErrors((prev) => ({
            ...prev,
            [h.symbol]: res.error ?? "trigger 실패",
          }));
        } else {
          setTriggered((prev) => new Set(prev).add(h.symbol));
        }
      }
    });
  };

  const statusLabel = (() => {
    if (!firstTriggered) return null;
    if (polling.timedOut) return "⏱ 시간 초과";
    if (polling.error) return `⚠️ ${polling.error}`;
    if (polling.run?.status === "running") return "⏳ 분석 중…";
    if (polling.run?.status === "queued") return "⏳ 대기 중…";
    if (polling.run?.status === "failed")
      return `⚠️ 실패: ${polling.run.errorMessage ?? "알 수 없음"}`;
    return "준비 중…";
  })();

  return (
    <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-[var(--color-text-muted)]">
          {holdings.length}개 종목 분석 대기 중 (예상 30-60초/종목)
        </p>
        {triggered.size === 0 ? (
          <button
            type="button"
            onClick={triggerAll}
            disabled={pending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "시작 중…" : "지금 분석"}
          </button>
        ) : (
          statusLabel && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {statusLabel}
            </span>
          )
        )}
      </div>
      <ul className="space-y-1 text-xs">
        {holdings.map((h) => (
          <li key={h.id} className="flex items-center justify-between">
            <span>
              {h.symbol} · {h.displayName}
            </span>
            {errors[h.symbol] && (
              <span className="text-red-600">{errors[h.symbol]}</span>
            )}
            {triggered.has(h.symbol) && !errors[h.symbol] && (
              <span className="text-emerald-600">큐 등록됨</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
