"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import {
  PERSONA_DISPLAY,
  type PersonaKey,
  type PersonaAnalysis,
  type Consensus,
  type MarketSnapshot,
} from "@/entities/stock-analysis/client";
import {
  ConsensusBadge,
  PersonaTab,
} from "@/entities/stock-analysis/client";
import { triggerAnalysis } from "@/features/stock-analysis-server";
import { Modal } from "@/shared/ui/Modal";
import { PriceChart } from "@/shared/ui/PriceChart";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding: PortfolioHolding;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  snapshot: MarketSnapshot;
  dailyOHLC: Array<{ date: string; close: number; volume: number }>;
}

const PERSONA_ORDER: PersonaKey[] = [
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
];

function FundamentalCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums">
        {typeof value === "number" ? `${value.toLocaleString()}${suffix ?? ""}` : "—"}
      </div>
    </div>
  );
}

export function StockDetailModal({
  open,
  onOpenChange,
  holding,
  personas,
  consensus,
  snapshot,
  dailyOHLC,
}: Props) {
  const [activeTab, setActiveTab] = useState<PersonaKey>(
    PERSONA_ORDER.find((p) => personas[p]) ?? "wallStreet",
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${holding.displayName} · ${holding.symbol}`}
      description={`${holding.market} · ${snapshot.currency} ${snapshot.price.toLocaleString()} (${snapshot.changePct >= 0 ? "+" : ""}${snapshot.changePct.toFixed(2)}%)`}
      size="xl"
    >
      <div className="flex flex-col gap-6">
        {/* 합의 hero */}
        <section
          aria-labelledby="consensus-heading"
          className="rounded-xl bg-gradient-to-br from-[var(--color-surface-2)] to-[var(--color-surface)] p-4"
        >
          <div className="flex items-center justify-between">
            <h3 id="consensus-heading" className="text-base font-bold">
              ▶ 합의 분석
            </h3>
            <ConsensusBadge verdict={consensus.verdict} score={consensus.score} />
          </div>
          <p className="mt-2 text-sm leading-relaxed">
            {consensus.oneLineConsensus}
          </p>
          {consensus.agreements.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                공통 결론
              </div>
              <ul className="mt-1 list-inside list-disc text-xs">
                {consensus.agreements.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {consensus.disagreements.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                의견 갈림
              </div>
              <ul className="mt-1 list-inside list-disc text-xs">
                {consensus.disagreements.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
              핵심 리스크
            </div>
            <ol className="mt-1 list-inside list-decimal text-xs">
              {consensus.riskRanking.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          </div>
          {consensus.failedPersonas.length > 0 && (
            <p className="mt-3 text-[10px] text-[var(--color-text-muted)]">
              ⚠️ 분석 실패:{" "}
              {consensus.failedPersonas.map((p) => PERSONA_DISPLAY[p]).join(", ")}
            </p>
          )}
        </section>

        {/* 차트 + 펀더멘털 */}
        <section aria-labelledby="data-heading" className="flex flex-col gap-3">
          <h3
            id="data-heading"
            className="text-sm font-semibold text-[var(--color-text-muted)]"
          >
            시장 데이터
          </h3>
          <PriceChart data={dailyOHLC} currency={snapshot.currency} />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <FundamentalCard label="시가총액" value={snapshot.marketCap} />
            <FundamentalCard label="PER" value={snapshot.per} />
            <FundamentalCard label="PBR" value={snapshot.pbr} />
            <FundamentalCard
              label="배당수익률"
              value={
                snapshot.dividendYield ? snapshot.dividendYield * 100 : undefined
              }
              suffix="%"
            />
          </div>
        </section>

        {/* 페르소나 탭 */}
        <section aria-labelledby="personas-heading">
          <h3
            id="personas-heading"
            className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]"
          >
            페르소나별 분석
          </h3>
          <div
            role="tablist"
            className="mb-3 flex flex-wrap gap-2 border-b border-[var(--color-hairline)]"
          >
            {PERSONA_ORDER.map((p) => {
              const available = !!personas[p];
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === p}
                  onClick={() => setActiveTab(p)}
                  disabled={!available}
                  className={`px-3 py-2 text-xs font-semibold ${
                    activeTab === p
                      ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  } ${!available ? "opacity-40" : ""}`}
                >
                  {PERSONA_DISPLAY[p]}
                  {!available && <span className="ml-1 text-[8px]">✕</span>}
                </button>
              );
            })}
          </div>
          <PersonaTab
            persona={activeTab}
            analysis={personas[activeTab] ?? null}
            symbol={holding.symbol}
            onRegenerate={() =>
              triggerAnalysis({ symbol: holding.symbol, persona: activeTab })
            }
          />
        </section>

        {/* 면책 */}
        <footer className="border-t border-[var(--color-hairline)] pt-4 text-[10px] text-[var(--color-text-muted)]">
          본 분석은 LLM 페르소나의 가상 의견이며 투자 자문이 아닙니다. 실제 투자 결정은 본인 책임입니다.
        </footer>
      </div>
    </Modal>
  );
}
