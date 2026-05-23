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
  const [kind, setKind] = useState<"holding" | "watchlist">("holding");
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
    if (kind === "holding") {
      if (quantity.length === 0 || avgCost.length === 0) {
        setAddError("수량과 평단을 입력해주세요");
        return;
      }
      if (Number(quantity) <= 0) {
        setAddError("수량은 0보다 커야 합니다");
        return;
      }
      if (Number(avgCost) < 0) {
        setAddError("평단은 0 이상이어야 합니다");
        return;
      }
    }
    setBusy(true);
    setAddError(null);
    const base = {
      symbol: selected.symbol,
      assetClass: selected.assetClass,
      market: selected.market,
      displayName: selected.displayName,
      purchasedAt: purchasedAt.length > 0 ? purchasedAt : undefined,
    };
    const res = await addHolding(
      kind === "holding"
        ? { ...base, kind: "holding" as const, quantity, avgCost }
        : {
            ...base,
            kind: "watchlist" as const,
            quantity: quantity.length > 0 ? quantity : undefined,
            avgCost: avgCost.length > 0 ? avgCost : undefined,
          },
    );
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

  const holdings = initialHoldings.filter((h) => h.kind === "holding");
  const watchlist = initialHoldings.filter((h) => h.kind === "watchlist");

  const renderSection = (
    label: string,
    rows: PortfolioHolding[],
    emptyHint: string,
  ) => (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label} ({rows.length})
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-3 py-2">종목</th>
            <th className="px-3 py-2">자산군</th>
            <th className="px-3 py-2 text-right">수량</th>
            <th className="px-3 py-2 text-right">평단</th>
            <th className="px-3 py-2 text-right">매수일</th>
            <th className="px-3 py-2 text-center">🔔</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]"
              >
                {emptyHint}
              </td>
            </tr>
          ) : (
            rows.map((h) => <HoldingRow key={h.id} holding={h} onMutate={refresh} />)
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {renderSection("보유", holdings, "보유 종목이 없습니다.")}
      {renderSection("관심", watchlist, "관심 종목이 없습니다.")}

      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">+ 종목 추가</div>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="add-kind"
                value="holding"
                checked={kind === "holding"}
                onChange={() => setKind("holding")}
              />
              보유
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="add-kind"
                value="watchlist"
                checked={kind === "watchlist"}
                onChange={() => setKind("watchlist")}
              />
              관심 (수량 없음)
            </label>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <TickerSearchInput onSelect={setSelected} />
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={kind === "watchlist" ? "(선택)" : "수량"}
            disabled={busy}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          />
          <input
            type="text"
            inputMode="decimal"
            value={avgCost}
            onChange={(e) => setAvgCost(e.target.value)}
            placeholder={kind === "watchlist" ? "(선택)" : "평단"}
            disabled={busy}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
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
