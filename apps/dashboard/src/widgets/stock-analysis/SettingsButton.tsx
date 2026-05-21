"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import type {
  ModelName,
  PersonaOrConsensus,
} from "@/entities/stock-analysis/client";
import { PortfolioSettingsModal } from "./PortfolioSettingsModal";

interface Props {
  initialHoldings: PortfolioHolding[];
  initialOverrides: Partial<Record<PersonaOrConsensus, ModelName>>;
}

export function SettingsButton({ initialHoldings, initialOverrides }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="포트폴리오 설정"
        className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
      >
        ⚙
      </button>
      <PortfolioSettingsModal
        open={open}
        onOpenChange={setOpen}
        initialHoldings={initialHoldings}
        initialOverrides={initialOverrides}
      />
    </>
  );
}
