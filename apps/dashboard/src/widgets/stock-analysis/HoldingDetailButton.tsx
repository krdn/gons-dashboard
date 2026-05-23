"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import type {
  PersonaKey,
  PersonaAnalysis,
  Consensus,
  MarketSnapshot,
} from "@/entities/stock-analysis/client";
import { ConsensusBadge } from "@/entities/stock-analysis/client";
import { StockDetailModal } from "./StockDetailModal";
import { formatChange } from "./HoldingDetailButton.utils";

interface Props {
  holding: PortfolioHolding;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  snapshot: MarketSnapshot;
  dailyOHLC: Array<{ date: string; close: number; volume: number }>;
  variant: "hero" | "row";
}

const VERDICT_LABEL: Record<Consensus["verdict"], string> = {
  BUY: "매수",
  HOLD: "보유",
  SELL: "매도",
};

export function HoldingDetailButton({
  holding,
  personas,
  consensus,
  snapshot,
  dailyOHLC,
  variant,
}: Props) {
  const [open, setOpen] = useState(false);
  const change = formatChange(
    snapshot.price,
    holding.avgCost == null ? null : Number(holding.avgCost),
  );

  if (variant === "hero") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 text-left transition hover:from-emerald-100 hover:to-emerald-200"
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            ▶ 오늘의 시선 · {consensus.score.split("/")[0]}명{" "}
            {VERDICT_LABEL[consensus.verdict]}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <strong className="text-lg">{holding.displayName}</strong>
            <span
              className={`text-sm font-semibold tabular-nums ${change.color}`}
            >
              {change.label}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--color-text)]">
            {consensus.oneLineConsensus}
          </p>
        </button>
        <StockDetailModal
          open={open}
          onOpenChange={setOpen}
          holding={holding}
          personas={personas}
          consensus={consensus}
          snapshot={snapshot}
          dailyOHLC={dailyOHLC}
        />
      </>
    );
  }

  // variant === "row"
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg bg-[var(--color-surface)] px-3 py-2 text-xs transition hover:bg-[var(--color-surface-2)]"
      >
        <span className="font-semibold">{holding.symbol}</span>
        <ConsensusBadge
          verdict={consensus.verdict}
          score={consensus.score}
          size="sm"
        />
        <span className={`tabular-nums ${change.color}`}>{change.label}</span>
      </button>
      <StockDetailModal
        open={open}
        onOpenChange={setOpen}
        holding={holding}
        personas={personas}
        consensus={consensus}
        snapshot={snapshot}
        dailyOHLC={dailyOHLC}
      />
    </>
  );
}
