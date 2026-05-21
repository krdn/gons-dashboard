"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import type {
  ModelName,
  PersonaOrConsensus,
} from "@/entities/stock-analysis/client";
import { Modal } from "@/shared/ui/Modal";
import { PortfolioTable } from "@/features/stock-portfolio-crud/ui/PortfolioTable";
import { PersonaModelPicker } from "@/features/stock-persona-config/ui/PersonaModelPicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialHoldings: PortfolioHolding[];
  initialOverrides: Partial<Record<PersonaOrConsensus, ModelName>>;
}

type Tab = "portfolio" | "llm";

const TABS: { id: Tab; label: string }[] = [
  { id: "portfolio", label: "포트폴리오" },
  { id: "llm", label: "LLM 모델" },
];

export function PortfolioSettingsModal({
  open,
  onOpenChange,
  initialHoldings,
  initialOverrides,
}: Props) {
  const [tab, setTab] = useState<Tab>("portfolio");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="포트폴리오 설정"
      description="등록한 종목과 페르소나별 LLM 모델을 관리합니다."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div role="tablist" className="flex gap-2 border-b border-[var(--color-hairline)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold ${
                tab === t.id
                  ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div>
          {tab === "portfolio" && <PortfolioTable initialHoldings={initialHoldings} />}
          {tab === "llm" && <PersonaModelPicker initialOverrides={initialOverrides} />}
        </div>
        <footer className="border-t border-[var(--color-hairline)] pt-4 text-[10px] text-[var(--color-text-muted)]">
          본 분석은 LLM 페르소나의 가상 의견이며 투자 자문이 아닙니다. 실제 투자 결정은 본인 책임입니다.
        </footer>
      </div>
    </Modal>
  );
}
