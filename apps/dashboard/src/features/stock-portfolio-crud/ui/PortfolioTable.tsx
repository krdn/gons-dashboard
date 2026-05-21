"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import type { SearchResult } from "@/entities/stock/client";
import { TickerSearchInput } from "./TickerSearchInput";
import { HoldingRow } from "./HoldingRow";
import { addHolding } from "../api/addHolding";

interface Props {
  initialHoldings: PortfolioHolding[];
}

export function PortfolioTable({ initialHoldings }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.refresh();

  const onAdd = async () => {
    if (!selected) {
      setAddError("검색에서 종목을 선택해주세요");
      return;
    }
    if (quantity.length === 0 || avgCost.length === 0) {
      setAddError("수량과 평단을 입력해주세요");
      return;
    }
    // UX validation: quantity > 0 (T4.2 우려 #1 — 정규식이 0 통과)
    if (Number(quantity) <= 0) {
      setAddError("수량은 0보다 커야 합니다");
      return;
    }
    if (Number(avgCost) < 0) {
      setAddError("평단은 0 이상이어야 합니다");
      return;
    }
    setBusy(true);
    setAddError(null);
    const res = await addHolding({
      symbol: selected.symbol,
      assetClass: selected.assetClass,
      market: selected.market,
      displayName: selected.displayName,
      quantity,
      avgCost,
      purchasedAt: purchasedAt.length > 0 ? purchasedAt : undefined,
    });
    setBusy(false);
    if (!res.success) {
      setAddError(res.error ?? "추가 실패");
      return;
    }
    setSelected(null);
    setQuantity("");
    setAvgCost("");
    setPurchasedAt("");
    refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-3 py-2">종목</th>
            <th className="px-3 py-2">자산군</th>
            <th className="px-3 py-2 text-right">수량</th>
            <th className="px-3 py-2 text-right">평단</th>
            <th className="px-3 py-2 text-right">매수일</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {initialHoldings.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]"
              >
                아직 등록된 종목이 없습니다. 아래에서 추가해주세요.
              </td>
            </tr>
          ) : (
            initialHoldings.map((h) => (
              <HoldingRow key={h.id} holding={h} onMutate={refresh} />
            ))
          )}
        </tbody>
      </table>

      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4">
        <div className="mb-2 text-sm font-semibold">+ 종목 추가</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <TickerSearchInput onSelect={setSelected} />
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="수량"
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums focus:border-[var(--color-accent)] focus:outline-none"
          />
          <input
            type="text"
            inputMode="decimal"
            value={avgCost}
            onChange={(e) => setAvgCost(e.target.value)}
            placeholder="평단"
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums focus:border-[var(--color-accent)] focus:outline-none"
          />
          <input
            type="date"
            value={purchasedAt}
            onChange={(e) => setPurchasedAt(e.target.value)}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={busy}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "추가 중…" : "추가"}
          </button>
        </div>
        {addError && <div className="mt-2 text-xs text-red-600">{addError}</div>}
      </div>
    </div>
  );
}
